/**
 * Live diagnostic against the real Gemini API. Skipped unless GEMINI_LIVE_KEY is set, so normal test
 * runs never make network calls. Prints only HTTP status and Google's error message (which describes
 * our request, not user data) to the local terminal. Run from server/:
 *
 *   read -rs GEMINI_LIVE_KEY && GEMINI_LIVE_KEY=$GEMINI_LIVE_KEY pnpm vitest run test/gemini-live.test.ts; unset GEMINI_LIVE_KEY
 */
import { describe, it } from 'vitest';
import { GeminiProvider } from '../src/providers/gemini';
import { parseMealPrompt } from '../src/prompts';
import { itemsJsonSchema, itemsOutput } from '../src/schemas';

const KEY = process.env.GEMINI_LIVE_KEY ?? '';
const MODEL = 'gemini-3.5-flash-lite';
const VARIANTS: [string, Record<string, unknown> | undefined][] = [['as deployed', itemsJsonSchema]];

describe.skipIf(!KEY)('live Gemini diagnostic', () => {
  const base = new GeminiProvider({ apiKey: 'unused', model: MODEL, thinkingLevel: 'LOW' }).buildRequestBody({
    ...parseMealPrompt('Stir-fry rice noodles with crispy duck breast', 'en'),
    schema: itemsJsonSchema,
  }) as { generationConfig: Record<string, unknown> };

  for (const [name, schema] of VARIANTS) {
    it(`${MODEL}: ${name}`, { timeout: 60_000 }, async () => {
      const body = { ...base, generationConfig: { ...base.generationConfig, responseJsonSchema: schema } };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let detail = '';
      try {
        const json = JSON.parse(text) as {
          error?: { status?: string; message?: string };
          candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        };
        if (json.error) {
          detail = `${json.error.status}: ${json.error.message}`;
        } else {
          const out = (json.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
          const parsed = itemsOutput.safeParse(JSON.parse(out));
          const estimates = parsed.success ? parsed.data.items.filter((i) => i.per_100g !== null).length : 0;
          detail = parsed.success
            ? `OK, valid, ${parsed.data.items.length} items, ${estimates} with nutrient estimates`
            : 'OK but output fails validation';
        }
      } catch {
        detail = 'OK but output is not JSON';
      }
      console.log(`[${res.status}] ${name} -> ${detail.slice(0, 300)}`);
    });
  }
});
