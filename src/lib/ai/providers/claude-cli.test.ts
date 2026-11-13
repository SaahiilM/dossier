import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ClaudeCliProvider } from "./claude-cli";
import { CliRunnerError, safeCliEnvironment, runCli, type CliRunOptions } from "./cli-runner";

const request = { task: "draft-reply" as const, system: "System prompt", messages: [{ role: "user" as const, content: "Private prompt" }] };

describe("Claude Code CLI provider", () => {
  it("uses a fixed executable, isolated cwd, OAuth-safe environment and stdin prompt", async () => {
    const runner = vi.fn(async (_options: CliRunOptions) => ({ stdout: JSON.stringify({ result: "answer", is_error: false }), stderr: "", code: 0 }));
    const provider = new ClaudeCliProvider({ model: "sonnet-user-choice", executable: "/opt/claude", runner, env: { PATH: "/bin", HOME: "/tmp", NODE_ENV: "test", DOSSIER_KEY: "secret", DATABASE_URL: "postgres://private", CLAUDE_CONFIG_DIR: "/private/profile", ANTHROPIC_API_KEY: "secret", ANTHROPIC_AUTH_TOKEN: "token" } });
    expect(await provider.complete(request)).toBe("answer");
    const opts = runner.mock.calls[0][0];
    expect(opts.executable).toBe("/opt/claude");
    expect(opts.args).toContain("--strict-mcp-config");
    expect(opts.args).toContain("--no-session-persistence");
    expect(opts.args).toContain("--max-turns");
    expect(opts.args).toContain("1");
    expect(opts.args).toContain("");
    expect(opts.args).toContain("--restricted");
    expect(opts.input).toContain("Private prompt");
    expect(opts.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(opts.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(opts.env).not.toHaveProperty("DOSSIER_KEY");
    expect(opts.env).not.toHaveProperty("DATABASE_URL");
    expect(opts.env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
    expect(opts.args[opts.args.indexOf("--mcp-config") + 1]).toBe(JSON.stringify({ mcpServers: {} }));
    expect(opts.args[opts.args.indexOf("--setting-sources") + 1]).toBe("");
    expect(opts.cwd).toContain("dossier-claude-");
    expect(opts.maxOutputBytes).toBeGreaterThan(0);
  });

  it("validates JSON through BaseProvider and uses only the user supplied model", async () => {
    const runner = vi.fn(async (_options: CliRunOptions) => ({ stdout: JSON.stringify({ structured_output: { ok: true } }), stderr: "", code: 0 }));
    const provider = new ClaudeCliProvider({ model: "explicit-model", executable: "/claude", runner });
    expect(await provider.complete({ ...request, schema: z.object({ ok: z.boolean() }) })).toEqual({ ok: true });
    expect(runner.mock.calls[0]?.[0].args).toContain("explicit-model");
    expect(runner.mock.calls[0]?.[0].args).toContain("--json-schema");
  });

  it("maps failures without exposing stderr or prompts", async () => {
    const runner = vi.fn(async (_options: CliRunOptions) => { throw new CliRunnerError("exit", "secret stderr"); });
    const provider = new ClaudeCliProvider({ model: "m", executable: "/claude", runner });
    const error = await provider.complete(request).catch((e: unknown) => e instanceof Error ? e : new Error(String(e)));
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain("secret");
    expect(message).not.toContain("Private prompt");
  });

  it("strips API billing overrides from its child environment", () => {
    const env = safeCliEnvironment({ PATH: "/bin", HOME: "/home/user", NODE_ENV: "test", DOSSIER_SECRET: "x", DATABASE_URL: "postgres://x", CLAUDE_CONFIG_DIR: "/tmp/alternate", ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: "https://proxy" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.DOSSIER_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.HOME).toBe("/home/user");
  });
});

describe("bounded CLI runner", () => {
  it("rejects missing executables without a shell", async () => {
    await expect(runCli({ executable: "/no/such/claude", args: [], timeoutMs: 500 })).rejects.toMatchObject({ reason: "missing" });
  });

  it("kills on abort, timeout and output cap", async () => {
    const script = "process.stdin.resume(); setTimeout(() => process.stdout.write('0123456789'), 2000)";
    const abort = new AbortController();
    const aborted = runCli({ executable: process.execPath, args: ["-e", script], timeoutMs: 3000, signal: abort.signal });
    abort.abort();
    await expect(aborted).rejects.toMatchObject({ reason: "aborted" });
    await expect(runCli({ executable: process.execPath, args: ["-e", "setTimeout(()=>{},2000)"], timeoutMs: 20 })).rejects.toMatchObject({ reason: "timeout" });
    await expect(runCli({ executable: process.execPath, args: ["-e", "process.stdout.write('0123456789')"], timeoutMs: 500, maxOutputBytes: 4 })).rejects.toMatchObject({ reason: "output-limit" });
  });

  it("preserves UTF-8 characters split across process output chunks", async () => {
    const result = await runCli({
      executable: process.execPath,
      args: ["-e", "process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x9c, 0x93])), 10)"],
      timeoutMs: 1_000,
    });
    expect(result.stdout).toBe("✓");
  });
});
