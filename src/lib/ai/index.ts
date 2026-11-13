import "server-only";

import { AiProvider } from "@/generated/prisma/enums";
import { recordUsage } from "@/lib/usage-data";

import { loadAiConfig, type AiConfig } from "./config";
import { AiError } from "./errors";
import { providerOption } from "./provider-options";
import type { AIProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { LocalProvider } from "./providers/local";
import { LmStudioProvider } from "./providers/lmstudio";
import { MistralProvider } from "./providers/mistral";
import { ChatGptSubscriptionProvider } from "./providers/chatgpt-subscription";
import { ClaudeCliProvider } from "./providers/claude-cli";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

export { AiError } from "./errors";
export type { AIProvider, ChatMessage, CompletionRequest, JsonCompletionRequest } from "./provider";

/**
 * A provider for `config`, keeping each answer's tokens for the Usage screen.
 * A saved key that can't be read stops hosted providers with a clear message.
 */
export function createProvider(config: AiConfig): AIProvider {
  const { provider, baseUrl, model, apiKey, apiKeyProblem, timeoutMs } = config;
  if (apiKeyProblem && providerOption(provider).apiKey) throw AiError.config(apiKeyProblem);
  switch (provider) {
    case AiProvider.LOCAL:
      return new LocalProvider(baseUrl, model, timeoutMs, recordUsage);
    case AiProvider.OPENAI:
      return new OpenAICompatibleProvider("OPENAI", baseUrl, apiKey, model, timeoutMs, recordUsage);
    case AiProvider.ANTHROPIC:
      return new AnthropicProvider(baseUrl, apiKey, model, timeoutMs, recordUsage);
    case AiProvider.MISTRAL:
      return new MistralProvider(baseUrl, apiKey, model, timeoutMs, recordUsage);
    case AiProvider.LMSTUDIO:
      return new LmStudioProvider(baseUrl, apiKey, model, timeoutMs, recordUsage);
    case AiProvider.OPENROUTER:
      if (!apiKey) throw AiError.config("Enter your OpenRouter API key in Settings → AI provider first.");
      return new OpenAICompatibleProvider("OPENROUTER", baseUrl, apiKey, model, timeoutMs, recordUsage);
    case AiProvider.CHATGPT_SUBSCRIPTION:
      if (!config.chatGptAccountSub) throw AiError.config("Connect ChatGPT in Settings → AI provider first.");
      return new ChatGptSubscriptionProvider(model, config.chatGptAccountSub, timeoutMs, recordUsage);
    case AiProvider.CLAUDE_CLI:
      return new ClaudeCliProvider({ model, timeoutMs, usage: recordUsage });
  }
}

/** The provider configured in Settings, or by the DOSSIER_AI_* variables. */
export async function getAiProvider(): Promise<AIProvider> {
  return createProvider(await loadAiConfig());
}
