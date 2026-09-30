import { type AiProvider, type GenerateJsonRequest, ProviderError } from './types';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const THINKING_LEVELS = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);
const MAX_UPSTREAM_RESPONSE_BYTES = 512 * 1024;
const RETRY_MIN_REMAINING_MS = 8_000;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  fallbackModel?: string;
  thinkingLevel?: string;
  temperature?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

const MESSAGE_TOPICS: [RegExp, string][] = [
  [/schema/i, 'schema'],
  [/image|inline_?data|mime/i, 'image'],
  [/thinking/i, 'thinking'],
  [/temperature/i, 'temperature'],
  [/token/i, 'tokens'],
  [/model/i, 'model'],
];

/**
 * Google's enum-like `error.status` (e.g. "INVALID_ARGUMENT") plus a fixed topic derived from the
 * message (e.g. "INVALID_ARGUMENT/schema"). The message text itself is never returned.
 */
async function upstreamErrorCode(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    if (text.length > 64 * 1024) return undefined;
    const error = (JSON.parse(text) as { error?: { status?: unknown; message?: unknown } }).error;
    const status = typeof error?.status === 'string' && /^[A-Z_]{1,40}$/.test(error.status) ? error.status : undefined;
    if (!status) return undefined;
    const message = typeof error?.message === 'string' ? error.message : '';
    const topic = MESSAGE_TOPICS.find(([re]) => re.test(message))?.[1] ?? 'other';
    return `${status}/${topic}`;
  } catch {
    return undefined;
  }
}

export class GeminiProvider implements AiProvider {
  private readonly model: string;
  private readonly fallbackModel: string;

  constructor(private readonly config: GeminiConfig) {
    if (!config.apiKey) throw new ProviderError('missing_api_key');
    const fallback = config.fallbackModel || config.model;
    if (!MODEL_ID_PATTERN.test(config.model) || !MODEL_ID_PATTERN.test(fallback)) throw new ProviderError('invalid_model_id');
    this.model = config.model;
    this.fallbackModel = fallback;
  }

  buildRequestBody(req: GenerateJsonRequest): Record<string, unknown> {
    const parts: Record<string, unknown>[] = [];
    if (req.imageBase64 && req.mimeType) {
      parts.push({ inlineData: { mimeType: req.mimeType, data: req.imageBase64 } });
    }
    parts.push({ text: req.userText });

    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      responseJsonSchema: req.schema,
      maxOutputTokens: this.config.maxOutputTokens ?? 4096,
      candidateCount: 1,
    };
    const level = this.config.thinkingLevel?.trim().toUpperCase();
    if (level && THINKING_LEVELS.has(level)) generationConfig.thinkingConfig = { thinkingLevel: level };
    const temperature = this.config.temperature?.trim() ? Number(this.config.temperature) : NaN;
    if (Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) generationConfig.temperature = temperature;

    return {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
    };
  }

  private async post(model: string, body: string, timeoutMs: number): Promise<Response> {
    const doFetch = this.config.fetchImpl ?? fetch;
    try {
      return await doFetch(`${API_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.config.apiKey,
        },
        body,
        // Workers reject redirect: 'error'; 'manual' returns 3xx unfollowed, which !res.ok rejects below.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      throw new ProviderError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error');
    }
  }

  async generateJson(req: GenerateJsonRequest): Promise<unknown> {
    const body = JSON.stringify(this.buildRequestBody(req));
    // Total budget across attempts; must stay below the app's own request timeout (30 s for text).
    const deadline = Date.now() + (this.config.timeoutMs ?? 25_000);
    let model = this.model;
    let res = await this.post(model, body, deadline - Date.now());
    // 500/503: the model is briefly overloaded. 429: its quota is used up, which is tracked per model,
    // so only a different fallback model can help.
    const overloaded = res.status === 500 || res.status === 503;
    const quota = res.status === 429 && this.fallbackModel !== this.model;
    if ((overloaded || quota) && deadline - Date.now() > RETRY_MIN_REMAINING_MS) {
      await res.body?.cancel().catch(() => undefined);
      if (overloaded) await new Promise((r) => setTimeout(r, this.config.retryDelayMs ?? 1_500));
      model = this.fallbackModel;
      res = await this.post(model, body, deadline - Date.now());
    }

    if (!res.ok) throw new ProviderError('http_error', res.status, await upstreamErrorCode(res), model);

    let payload: GeminiResponse;
    try {
      const text = await res.text();
      if (text.length > MAX_UPSTREAM_RESPONSE_BYTES) throw new Error('too large');
      payload = JSON.parse(text) as GeminiResponse;
    } catch {
      throw new ProviderError('bad_upstream_body');
    }

    if (payload.promptFeedback?.blockReason) throw new ProviderError('prompt_blocked');
    const candidate = payload.candidates?.[0];
    if (!candidate) throw new ProviderError('no_candidate');
    if (candidate.finishReason !== 'STOP') {
      const reason = String(candidate.finishReason ?? 'missing').toLowerCase().replace(/[^a-z_]/g, '').slice(0, 32);
      throw new ProviderError(`finish_${reason}`);
    }

    const text = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('invalid_json');
    }
  }
}
