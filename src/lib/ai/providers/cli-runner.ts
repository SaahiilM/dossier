import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export type CliResult = { stdout: string; stderr: string; code: number };
export type CliRunOptions = {
  executable: string;
  args: string[];
  input?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export class CliRunnerError extends Error {
  constructor(readonly reason: "missing" | "aborted" | "timeout" | "output-limit" | "spawn" | "exit", message: string) {
    super(message);
    this.name = "CliRunnerError";
  }
}

const MAX_OUTPUT = 4 * 1024 * 1024;

/** Runs a fixed executable without a shell, bounding time and combined output. */
export async function runCli(options: CliRunOptions): Promise<CliResult> {
  if (options.signal?.aborted) throw new CliRunnerError("aborted", "CLI call cancelled.");
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.executable, options.args, {
        shell: false,
        cwd: options.cwd,
        env: options.env ?? safeCliEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      reject(new CliRunnerError("spawn", "Could not start the CLI."));
      return;
    }
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let bytes = 0;
    let settled = false;
    let failure: CliRunnerError | undefined;
    let hardKill: NodeJS.Timeout | undefined;
    const finish = (error?: CliRunnerError, result?: CliResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardKill) clearTimeout(hardKill);
      options.signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result!);
    };
    const kill = (reason: CliRunnerError) => {
      if (failure) return;
      failure = reason;
      child.kill("SIGTERM");
      hardKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
      hardKill.unref();
    };
    const abort = () => kill(new CliRunnerError("aborted", "CLI call cancelled."));
    const timer = setTimeout(() => kill(new CliRunnerError("timeout", "CLI call timed out.")), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    // The signal may have changed between the pre-spawn check and listener registration.
    if (options.signal?.aborted) abort();
    const max = options.maxOutputBytes ?? MAX_OUTPUT;
    const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > max) {
        kill(new CliRunnerError("output-limit", "CLI output exceeded its size limit."));
        return;
      }
      if (target === "stdout") stdout += stdoutDecoder.write(chunk);
      else stderr += stderrDecoder.write(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(new CliRunnerError(error.code === "ENOENT" ? "missing" : "spawn", error.code === "ENOENT" ? "Claude Code CLI was not found." : "Could not start the CLI."));
    });
    child.on("close", (code) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      if (failure) return finish(failure);
      if (code !== 0) return finish(new CliRunnerError("exit", "Claude Code CLI returned an error."));
      finish(undefined, { stdout, stderr, code: code ?? 0 });
    });
    child.stdin.on("error", () => { /* A child may close stdin while being terminated. */ });
    child.stdin.end(options.input ?? "");
  });
}

/** Pass only process/runtime identity needed for OAuth and keychain access. */
export function safeCliEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const key of ["HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "SSH_AUTH_SOCK", "XDG_RUNTIME_DIR", "NODE_ENV"]) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  // Never inherit CLAUDE_CONFIG_DIR: it can redirect OAuth to another profile.
  env.PATH = [source.PATH, "/usr/local/bin", "/opt/homebrew/bin", join(source.HOME ?? "", ".local/bin"), "/usr/bin", "/bin"].filter(Boolean).join(delimiter);
  return env as NodeJS.ProcessEnv;
}

/** A temporary empty working directory prevents project-local Claude config discovery. */
export async function withIsolatedCwd<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "dossier-claude-"));
  try { return await run(cwd); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}
