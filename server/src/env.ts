export interface Env {
  /** Secret. Google Gemini API key. */
  GEMINI_API_KEY: string;
  /** Secret. Comma-separated lowercase hex SHA-256 hashes of valid device tokens. */
  DEVICE_TOKEN_HASHES: string;
  GEMINI_MODEL?: string;
  /** Used for the single retry when GEMINI_MODEL is overloaded (500/503). Empty = retry the same model. */
  GEMINI_FALLBACK_MODEL?: string;
  GEMINI_THINKING_LEVEL?: string;
  GEMINI_TEMPERATURE?: string;
  RATE_LIMIT_HOURLY?: string;
  RATE_LIMIT_DAILY?: string;
  RATE_LIMITER: DurableObjectNamespace;
}
