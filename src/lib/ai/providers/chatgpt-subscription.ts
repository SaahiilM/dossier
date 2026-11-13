import "server-only";

import { toJSONSchema } from "zod";

import type { TokenCount, UsageSink, UsageTask } from "@/lib/usage";
import { credential } from "@/lib/siwc";

import { AiError, toAiError } from "../errors";
import type { AIProvider, ChatMessage, CompletionRequest, JsonCompletionRequest } from "../provider";
import { validateJson } from "../provider";

import { readResponsesSse } from "./responses-sse";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODELS_URL = "https://api.openai.com/v1/models";

function responsesInputMessage(message: ChatMessage) {
  const partType = message.role === "assistant" ? "output_text" : "input_text";
  return { role: message.role, content: [{ type: partType, text: message.content }] };
}

/** ChatGPT-plan Responses provider. Model slugs come from listModels(). */
export class ChatGptSubscriptionProvider implements AIProvider {
  readonly kind = "CHATGPT_SUBSCRIPTION" as AIProvider["kind"];
  private readonly fetchImpl: typeof fetch;

  constructor(
    readonly model: string | null,
    private readonly accountSub?: string,
    private readonly timeoutMs = 120_000,
    private readonly onUsage?: UsageSink,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  complete(request: CompletionRequest): Promise<string>;
  complete<T>(request: JsonCompletionRequest<T>): Promise<T>;
  async complete<T>(request: CompletionRequest | JsonCompletionRequest<T>): Promise<string | T> {
    const model = this.requireModel();
    if (request.signal?.aborted) throw AiError.of("cancelled");

    const access = await credential(this.accountSub);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    const cancelled = () => request.signal?.aborted ?? false;
    const recordUsage = (tokens: TokenCount) =>
      this.onUsage?.({ task: request.task, provider: this.kind, model, ...tokens });

    const schema = "schema" in request ? request.schema : undefined;
    const schemaName = ("schemaName" in request && request.schemaName) || "result";

    try {
      const body: Record<string, unknown> = {
        model,
        instructions: request.system,
        input: request.messages.map(responsesInputMessage),
        store: false,
        stream: true,
      };
      if (schema) {
        body.text = {
          format: {
            type: "json_schema",
            name: schemaName,
            schema: toJSONSchema(schema),
            strict: true,
          },
        };
      }

      const response = await this.fetchImpl(RESPONSES_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access.accessToken}`,
          "content-type": "application/json",
        },
        signal: combined,
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`ChatGPT request failed (${response.status})`);
      if (!response.body) throw new Error("Missing response stream");

      const streamed = await readResponsesSse(response.body, combined);
      if (streamed.usage) recordUsage(streamed.usage);

      if (schema) {
        const parsed = validateJson(streamed.text, schema);
        if (!parsed.ok) throw AiError.of("invalid-output", parsed.problem.split("\n", 1)[0]);
        return parsed.data;
      }
      return streamed.text;
    } catch (error) {
      throw toAiError(error, { model, cancelled: cancelled(), timedOut: timeout.aborted && !cancelled() });
    }
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const model = this.model ?? "list";
    if (signal?.aborted) throw AiError.of("cancelled");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      const access = await credential(this.accountSub);
      const response = await this.fetchImpl(MODELS_URL, {
        headers: { authorization: `Bearer ${access.accessToken}` },
        signal: combined,
      });
      if (!response.ok) throw new Error(`ChatGPT model list failed (${response.status})`);
      const body = (await response.json()) as {
        models?: { slug?: string; visibility?: string }[];
        data?: { id?: string; visibility?: string }[];
      };
      const fromModels = (body.models ?? [])
        .filter((row) => row.slug && row.visibility === "list")
        .map((row) => row.slug!);
      if (fromModels.length) return fromModels.sort();
      return (body.data ?? [])
        .filter((row) => row.id && (!row.visibility || row.visibility === "list"))
        .map((row) => row.id!)
        .sort();
    } catch (error) {
      throw toAiError(error, { model, cancelled: signal?.aborted ?? false, timedOut: timeout.aborted && !signal?.aborted });
    }
  }

  async test(signal?: AbortSignal): Promise<{ model: string; latencyMs: number }> {
    const model = this.requireModel();
    const started = performance.now();
    await this.complete({
      task: "connection-check" satisfies UsageTask,
      system: "Answer OK.",
      messages: [{ role: "user", content: "Are you there?" }],
      signal,
    });
    return { model, latencyMs: Math.round(performance.now() - started) };
  }

  private requireModel(): string {
    if (!this.model) throw AiError.config("Choose a ChatGPT model.");
    return this.model;
  }
}
