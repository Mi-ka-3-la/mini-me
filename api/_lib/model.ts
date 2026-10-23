import Anthropic, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import { OUTPUT_JSON_SCHEMA } from '../../shared/schema.js';

export type Effort = 'low' | 'medium' | 'high';
export type ThinkingMode = 'adaptive' | 'minimal';

export type ModelSettings = {
  model: string;
  effort: Effort;
  thinking: ThinkingMode;
  maxTokens: number;
};

export type ModelCallArgs = ModelSettings & {
  system: string;
  user: string;
  timeoutMs: number;
};

export type ModelResult = {
  text: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
};

/** A failed upstream call, already reduced to a code. The SDK message is never kept. */
export class UpstreamError extends Error {
  constructor(
    readonly kind: 'rate_limited' | 'overloaded' | 'auth' | 'bad_request' | 'timeout' | 'other',
    readonly status: number,
    readonly retryAfter?: string,
  ) {
    super(kind);
  }
}

export type ModelCall = (args: ModelCallArgs) => Promise<ModelResult>;

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): ModelSettings {
  const effort = env.ANALYSIS_EFFORT;
  return {
    model: env.ANALYSIS_MODEL?.trim() || DEFAULT_MODEL,
    effort: effort === 'low' || effort === 'high' ? effort : 'medium',
    thinking: env.ANALYSIS_THINKING === 'minimal' ? 'minimal' : 'adaptive',
    maxTokens: 8000,
  };
}

/**
 * Thinking is on by default on the 5.5 models (ADR-18). "minimal" uses the lowest setting
 * each model accepts: between_tools on Sonnet, disabled on Haiku; Opus cannot turn it off.
 */
export function thinkingParam(
  model: string,
  mode: ThinkingMode,
): Anthropic.Messages.ThinkingConfigParam | undefined {
  if (mode === 'adaptive') return undefined;
  if (model.includes('sonnet')) return { type: 'between_tools' };
  if (model.includes('haiku')) return { type: 'disabled' };
  return undefined;
}

let client: Anthropic | null = null;

export const anthropicCall: ModelCall = async (args) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new UpstreamError('auth', 500);
  client ??= new Anthropic({ apiKey, maxRetries: 0 });
  const thinking = thinkingParam(args.model, args.thinking);
  try {
    const res = await client.messages.create(
      {
        model: args.model,
        max_tokens: args.maxTokens,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
        output_config: {
          effort: args.effort,
          format: {
            type: 'json_schema',
            schema: OUTPUT_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        ...(thinking ? { thinking } : {}),
      },
      { timeout: args.timeoutMs, maxRetries: 0 },
    );
    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      stopReason: res.stop_reason ?? null,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  } catch (e) {
    throw toUpstreamError(e);
  }
};

export function toUpstreamError(e: unknown): UpstreamError {
  if (e instanceof UpstreamError) return e;
  if (e instanceof APIConnectionTimeoutError || e instanceof APIUserAbortError) {
    return new UpstreamError('timeout', 504);
  }
  if (e instanceof APIError) {
    const status = e.status ?? 0;
    const retryAfter = e.headers?.get?.('retry-after') ?? undefined;
    if (status === 429) return new UpstreamError('rate_limited', 429, retryAfter);
    if (status === 529) return new UpstreamError('overloaded', 529);
    if (status === 401 || status === 403) return new UpstreamError('auth', status);
    if (status === 400) return new UpstreamError('bad_request', 400);
    return new UpstreamError('other', status);
  }
  return new UpstreamError('other', 0);
}
