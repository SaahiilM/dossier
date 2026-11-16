import { MAX_SSE_BUFFER_BYTES } from "@/lib/siwc/constants";
import type { TokenCount } from "@/lib/usage";

export type ResponsesSseResult = {
  text: string;
  completed: boolean;
  usage?: TokenCount;
};

type SseEvent = {
  type?: string;
  delta?: string;
  response?: {
    status?: string;
    error?: { code?: string; message?: string };
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  error?: { code?: string; message?: string };
};

export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  let rest = buffer;
  let splitAt: number;
  while ((splitAt = rest.indexOf("\n\n")) >= 0) {
    const frame = rest.slice(0, splitAt);
    rest = rest.slice(splitAt + 2);
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data) as SseEvent);
    } catch {
      throw new Error("Invalid Responses stream event");
    }
  }
  return { events, rest };
}

export function applyResponsesEvents(state: ResponsesSseResult, events: SseEvent[]): ResponsesSseResult {
  let next = state;
  for (const event of events) {
    if (event.type === "response.output_text.delta") {
      next = { ...next, text: next.text + (event.delta ?? "") };
    }
    if (event.type === "response.completed") {
      const usage = event.response?.usage;
      next = {
        ...next,
        completed: true,
        usage: usage
          ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 }
          : next.usage,
      };
    }
    if (event.type === "response.failed" || event.type === "error") {
      const code = event.error?.code ?? event.response?.error?.code ?? "provider_error";
      throw new Error(`ChatGPT response failed (${code})`);
    }
    if (event.type === "response.incomplete") {
      throw new Error("ChatGPT response ended incomplete");
    }
  }
  return next;
}

export async function readResponsesSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<ResponsesSseResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let state: ResponsesSseResult = { text: "", completed: false };

  try {
    while (true) {
      if (signal?.aborted) {
        const reason = signal.reason;
        const error = new Error("ChatGPT request aborted");
        error.name = "AbortError";
        if (reason !== undefined) (error as Error & { cause?: unknown }).cause = reason;
        throw error;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_BUFFER_BYTES) throw new Error("Response stream too large");
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      state = applyResponsesEvents(state, parsed.events);
    }
    const tail = decoder.decode();
    if (tail) buffer += tail;
    if (buffer.trim()) {
      const parsed = parseSseChunk(`${buffer}\n\n`);
      state = applyResponsesEvents(state, parsed.events);
    }
  } finally {
    reader.releaseLock();
  }

  if (!state.completed) throw new Error("ChatGPT stream ended before response.completed");
  return state;
}
