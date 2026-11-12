import "server-only";

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

import type { UsageSink } from "@/lib/usage";

import { AiError } from "../errors";
import { BaseProvider, type ChatAnswer, type ChatCall, type AIProvider } from "../provider";
import { CliRunnerError, runCli, safeCliEnvironment, withIsolatedCwd, type CliRunOptions } from "./cli-runner";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const CLI_PATHS = ["/usr/local/bin/claude", "/opt/homebrew/bin/claude", "/usr/bin/claude"];

export type CliRunner = (options: CliRunOptions) => ReturnType<typeof runCli>;
export type ClaudeCliOptions = {
  model: string | null;
  timeoutMs?: number;
  usage?: UsageSink;
  executable?: string;
  runner?: CliRunner;
  env?: NodeJS.ProcessEnv;
};

/** Locate the installed CLI without invoking a shell. */
export async function findClaudeCli(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.PATH) for (const dir of env.PATH.split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const candidate = join(dir, "claude");
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try the next path. */ }
  }
  for (const candidate of [...CLI_PATHS, join(env.HOME ?? "", ".local/bin/claude")]) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try the next path. */ }
  }
  return null;
}

/** Claude Code through the user's existing OAuth subscription. */
export class ClaudeCliProvider extends BaseProvider {
  readonly kind = "CLAUDE_CLI" as AIProvider["kind"];
  private readonly runner: CliRunner;
  private executable: string | null;

  constructor(private readonly options: ClaudeCliOptions) {
    super(options.model, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.usage);
    this.runner = options.runner ?? runCli;
    this.executable = options.executable ?? null;
  }

  protected override acceptsTemperature(): boolean { return false; }

  protected async chat(call: ChatCall): Promise<ChatAnswer> {
    const executable = await this.getExecutable();
    const prompt = `${call.system}\n\n${call.messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n")}`;
    const settings = JSON.stringify({ disableAllHooks: true, permissions: { deny: ["*"], allow: [] } });
    const args = [
      "--print", "--output-format", "json", "--model", call.model,
      "--max-turns", "1", "--no-session-persistence", "--restricted", "--safe-mode",
      "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
      "--tools", "", "--disable-slash-commands", "--setting-sources", "", "--settings", settings,
      ...(call.json ? ["--json-schema", JSON.stringify((await import("zod")).toJSONSchema(call.json.schema))] : []),
    ];
    try {
      const result = await withIsolatedCwd((cwd) => this.runner({
        executable, args, input: prompt, signal: call.signal, timeoutMs: this.timeoutMs,
        maxOutputBytes: MAX_OUTPUT_BYTES, cwd, env: safeCliEnvironment(this.options.env),
      }));
      const payload = JSON.parse(result.stdout) as { result?: unknown; structured_output?: unknown; is_error?: boolean; subtype?: string };
      if (payload.is_error) throw AiError.of("provider");
      const text = payload.structured_output !== undefined ? JSON.stringify(payload.structured_output) : payload.result;
      if (typeof text !== "string") throw AiError.of("provider");
      // The CLI JSON does not expose token usage consistently; report no estimate.
      return { text, cutOff: payload.subtype === "error_max_turns" };
    } catch (error) {
      if (error instanceof AiError) throw error;
      if (error instanceof CliRunnerError) {
        if (error.reason === "aborted") throw error;
        if (error.reason === "timeout") throw error;
        if (error.reason === "missing") throw AiError.config("Install Claude Code CLI to use this provider.");
        if (error.reason === "output-limit") throw AiError.of("too-long");
        if (error.reason === "exit") throw AiError.of("auth", "Claude Code CLI did not complete; check `claude auth status`.");
      }
      // Never include CLI stderr/stdout or prompts in surfaced/logged errors.
      throw AiError.of("invalid-output");
    }
  }

  protected async fetchModels(_signal: AbortSignal): Promise<string[]> {
    return this.model ? [this.model] : [];
  }

  /** Return status only; deliberately discard CLI output that could contain account details. */
  async authStatus(signal?: AbortSignal): Promise<"authenticated" | "unauthenticated" | "unknown"> {
    const executable = await this.getExecutable().catch(() => null);
    if (!executable) return "unknown";
    try {
      const result = await withIsolatedCwd((cwd) => this.runner({ executable, args: ["auth", "status", "--json"], signal, timeoutMs: 10_000, maxOutputBytes: 64 * 1024, cwd, env: safeCliEnvironment(this.options.env) }));
      const status = JSON.parse(result.stdout) as { loggedIn?: boolean; authMethod?: string };
      return status.loggedIn === true && status.authMethod === "oauth_token" ? "authenticated" : "unauthenticated";
    } catch { return signal?.aborted ? "unknown" : "unauthenticated"; }
  }

  private async getExecutable(): Promise<string> {
    if (this.executable) return this.executable;
    const found = await findClaudeCli(this.options.env);
    if (!found) throw AiError.config("Claude Code CLI was not found. Install it or add it to PATH.");
    this.executable = found;
    return found;
  }
}

