import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError } from "../errors";

vi.mock("@/lib/siwc", () => ({
  credential: vi.fn(async () => ({
    sub: "sub",
    clientId: "oaiapp_x",
    accessToken: "access-token",
    refreshToken: "refresh",
    idToken: "id",
    expiresAt: Date.now() + 3_600_000,
    scopes: ["chatgpt.tokens.use.direct"],
    hostId: "urn:uuid:1",
    savedAt: new Date().toISOString(),
  })),
}));

import { ChatGptSubscriptionProvider } from "./chatgpt-subscription";
import { applyResponsesEvents, parseSseChunk } from "./responses-sse";

const sse = (events: object[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

describe("Responses SSE parsing", () => {
  it("accumulates text deltas and requires response.completed", () => {
    const chunk = sse([
      { type: "response.output_text.delta", delta: "Hel" },
      { type: "response.output_text.delta", delta: "lo" },
      { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 2 } } },
    ]);
    const { events, rest } = parseSseChunk(chunk);
    expect(rest).toBe("");
    const state = applyResponsesEvents({ text: "", completed: false }, events);
    expect(state).toEqual({
      text: "Hello",
      completed: true,
      usage: { input: 3, output: 2 },
    });
  });

  it("throws on response.failed and response.incomplete", () => {
    expect(() =>
      applyResponsesEvents({ text: "", completed: false }, [{ type: "response.failed", error: { code: "x" } }]),
    ).toThrow(/response failed/);
    expect(() =>
      applyResponsesEvents({ text: "", completed: false }, [{ type: "response.incomplete" }]),
    ).toThrow(/incomplete/);
  });
});

describe("ChatGptSubscriptionProvider", () => {
  it("sends json_schema text format, output_text for assistant turns, and UsageSink fields", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        sse([
          { type: "response.output_text.delta", delta: '{"ok":true}' },
          { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } },
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    const onUsage = vi.fn();
    const provider = new ChatGptSubscriptionProvider("gpt-test", "sub", 5_000, onUsage, fetchMock);
    const result = await provider.complete({
      task: "score-posting",
      system: "Return JSON",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "earlier" },
        { role: "user", content: "again" },
      ],
      schema: z.object({ ok: z.boolean() }),
      schemaName: "score",
    });
    expect(result).toEqual({ ok: true });
    expect(onUsage).toHaveBeenCalledWith({
      task: "score-posting",
      provider: "CHATGPT_SUBSCRIPTION",
      model: "gpt-test",
      input: 1,
      output: 1,
    });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "score", strict: true });
    expect(body.input[0].content[0].type).toBe("input_text");
    expect(body.input[1].content[0].type).toBe("output_text");
  });

  it("rejects an already-aborted signal before fetch", async () => {
    const fetchMock = vi.fn();
    const provider = new ChatGptSubscriptionProvider("gpt-test", undefined, 5_000, undefined, fetchMock);
    const signal = AbortSignal.abort();
    await expect(
      provider.complete({ task: "connection-check", system: "s", messages: [{ role: "user", content: "?" }], signal }),
    ).rejects.toBeInstanceOf(AiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists models from models[].slug when visibility is list", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-z", visibility: "list" },
            { slug: "hidden", visibility: "hidden" },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new ChatGptSubscriptionProvider(null, undefined, 5_000, undefined, fetchMock);
    await expect(provider.listModels()).resolves.toEqual(["gpt-z"]);
    const listCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(listCall[1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("fails when the stream ends before response.completed", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(sse([{ type: "response.output_text.delta", delta: "partial" }]), { status: 200 }),
    );
    const provider = new ChatGptSubscriptionProvider("gpt-test", undefined, 5_000, undefined, fetchMock);
    await expect(
      provider.complete({ task: "connection-check", system: "s", messages: [{ role: "user", content: "?" }] }),
    ).rejects.toBeInstanceOf(AiError);
  });

  it("throws AiError.config when no model is set", async () => {
    const provider = new ChatGptSubscriptionProvider(null);
    await expect(
      provider.complete({ task: "connection-check", system: "s", messages: [{ role: "user", content: "?" }] }),
    ).rejects.toEqual(AiError.config("Choose a ChatGPT model."));
  });
});
