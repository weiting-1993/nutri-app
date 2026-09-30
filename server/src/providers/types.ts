export interface GenerateJsonRequest {
  system: string;
  userText: string;
  imageBase64?: string;
  mimeType?: 'image/jpeg' | 'image/png';
  /** JSON Schema describing the required output. */
  schema: Record<string, unknown>;
}

/** Provider-agnostic interface; add e.g. `providers/mistral.ts` implementing it to switch providers. */
export interface AiProvider {
  /** Resolves with the parsed (but not yet validated) JSON value. Throws ProviderError on any failure. */
  generateJson(request: GenerateJsonRequest): Promise<unknown>;
}

/**
 * `reason` is a short, fixed code safe to log. Never contains upstream text; `upstreamCode` is only
 * ever an enum-like token such as "RESOURCE_EXHAUSTED" and `model` is our own configured model id.
 */
export class ProviderError extends Error {
  constructor(
    readonly reason: string,
    readonly upstreamStatus?: number,
    readonly upstreamCode?: string,
    readonly model?: string,
  ) {
    super(`provider error: ${reason}`);
  }
}
