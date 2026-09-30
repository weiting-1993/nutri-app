export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
};

export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

const GENERIC_MESSAGES: Record<number, string> = {
  400: 'Invalid request',
  401: 'Unauthorized',
  404: 'Not found',
  405: 'Method not allowed',
  413: 'Request body too large',
  415: 'Content-Type must be application/json',
  429: 'Too many requests',
  500: 'Something went wrong',
  502: 'AI service unavailable',
  503: 'AI quota exhausted',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Record<string, string> = {},
  ) {
    super(GENERIC_MESSAGES[status] ?? GENERIC_MESSAGES[500]);
  }
}

export function errorResponse(status: number, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse(status, { error: GENERIC_MESSAGES[status] ?? GENERIC_MESSAGES[500] }, extraHeaders);
}

export function isJsonContentType(header: string | null): boolean {
  if (!header) return false;
  const [type, ...params] = header.split(';').map((p) => p.trim().toLowerCase());
  if (type !== 'application/json') return false;
  return params.every((p) => !p.startsWith('charset=') || p === 'charset=utf-8' || p === 'charset="utf-8"');
}

/**
 * Reads the body enforcing `maxBytes` both on Content-Length and on the bytes actually
 * received (Content-Length may be absent or wrong with chunked transfer encoding).
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null) {
    if (!/^\d{1,10}$/.test(declared)) throw new HttpError(400);
    if (Number(declared) > maxBytes) throw new HttpError(413);
  }
  if (!request.body) throw new HttpError(400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413);
    }
    chunks.push(value);
  }
  if (total === 0) throw new HttpError(400);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new HttpError(400);
  }
}
