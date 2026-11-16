import "server-only";

import { PROVIDER_DEFAULTS } from "@/lib/ai/config";
import { AiProvider } from "@/generated/prisma/enums";
import { scorePosting } from "@/lib/ai/tasks/score-posting";
import { OpenAICompatibleProvider } from "@/lib/ai/providers/openai-compatible";
import { postingText } from "@/lib/job-search/search";
import type { ProfileData } from "@/lib/profile";
import type { UsageSink } from "@/lib/usage";

import type { JevPosting } from "./jev";

import { SCORE_POSTING_OPENROUTER_VERSION } from "./versions";
export { SCORE_POSTING_OPENROUTER_VERSION } from "./versions";

const OPENROUTER_URL = PROVIDER_DEFAULTS[AiProvider.OPENROUTER].baseUrl;

/**
 * Scores `posting` with an OpenRouter model that is separate from the AI
 * provider; `scoredWith` names this version and the model id.
 */
export async function scoreWithOpenRouter(
  posting: JevPosting,
  profile: ProfileData,
  { key, model, timeoutMs, signal, onUsage }: { key: string; model: string; timeoutMs: number; signal: AbortSignal; onUsage?: UsageSink },
) {
  const provider = new OpenAICompatibleProvider("OPENROUTER", OPENROUTER_URL, key, model, timeoutMs, onUsage);
  const { title, company, place, remote, salary } = posting;
  const { data } = await scorePosting(
    provider,
    { posting: postingText(posting), title, company, place, remote, salary, profile },
    { creativity: "FAITHFUL", strict: true, language: null, signal, usageTask: "score-posting-openrouter" },
  );
  return { data, scoredWith: `${SCORE_POSTING_OPENROUTER_VERSION} (${model})` };
}
