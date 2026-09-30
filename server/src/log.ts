export type SecurityEvent =
  | 'auth_failure'
  | 'auth_misconfigured'
  | 'validation_failure'
  | 'rate_limited'
  | 'rate_limiter_error'
  | 'upstream_failure'
  | 'model_output_invalid'
  | 'unhandled_error';

/** Only non-sensitive, enumerable metadata may be logged. Never tokens, keys, meal text, images or model output. */
export interface LogFields {
  route?: string;
  method?: string;
  status?: number;
  /** First 8 hex chars of the token hash only. */
  tokenHash?: string;
  reason?: string;
  upstreamStatus?: number;
  /** Enum-like upstream code plus a fixed topic (e.g. "INVALID_ARGUMENT/schema"), never upstream message text. */
  upstreamCode?: string;
  model?: string;
}

export function logEvent(event: SecurityEvent, fields: LogFields = {}): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: event === 'unhandled_error' || event === 'auth_misconfigured' ? 'error' : 'warn',
      event,
      ...fields,
    }),
  );
}
