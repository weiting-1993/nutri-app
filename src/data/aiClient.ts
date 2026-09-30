import * as SecureStore from 'expo-secure-store';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { z } from 'zod';
import {
  insightsResponseSchema,
  isValidDeviceToken,
  itemsResponseSchema,
  labelResponseSchema,
  normalizeServerUrl,
  type AiInsight,
  type AiItem,
  type AiLabel,
} from '../domain/ai';
import { fetchJson, HttpError } from './http';
import { getSetting, setSetting } from './userDb';

const TOKEN_KEY = 'ai.deviceToken';
const URL_SETTING = 'aiServerUrl';
const SECURE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
/** Must stay below the server's 1.5 MiB decoded limit. */
const MAX_IMAGE_B64 = 1_900_000;

export class AiError extends Error {
  constructor(
    readonly kind: 'not_configured' | 'unauthorized' | 'rate_limited' | 'unavailable' | 'bad_response' | 'bad_image',
    message: string,
  ) {
    super(message);
  }
}

export interface AiConfig {
  url: string | null;
  hasToken: boolean;
}

export async function getAiConfig(db: SQLiteDatabase): Promise<AiConfig> {
  const url = await getSetting(db, URL_SETTING);
  const token = await SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTS).catch(() => null);
  return { url: url && normalizeServerUrl(url), hasToken: !!token };
}

/** Returns an error message, or null on success. */
export async function saveAiConfig(db: SQLiteDatabase, rawUrl: string, token: string | null): Promise<string | null> {
  const url = normalizeServerUrl(rawUrl);
  if (!url) return 'Enter an https:// address with no path, e.g. https://nutri-ai.example.workers.dev';
  if (token !== null) {
    const t = token.trim();
    if (!isValidDeviceToken(t)) return 'That device token does not look right.';
    await SecureStore.setItemAsync(TOKEN_KEY, t, SECURE_OPTS);
  }
  await setSetting(db, URL_SETTING, url);
  return null;
}

export async function clearAiConfig(db: SQLiteDatabase): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTS).catch(() => undefined);
  await setSetting(db, URL_SETTING, '');
}

async function call<S extends z.ZodType>(db: SQLiteDatabase, path: string, body: unknown, schema: S, timeoutMs: number): Promise<z.infer<S>> {
  const { url, hasToken } = await getAiConfig(db);
  const token = hasToken ? await SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTS) : null;
  if (!url || !token) throw new AiError('not_configured', 'Set up the AI server in Profile → AI assistant first.');
  let res;
  try {
    res = await fetchJson(`${url}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      timeoutMs,
      maxBytes: 200_000,
    });
  } catch (e) {
    const timeout = e instanceof HttpError && e.kind === 'timeout';
    throw new AiError('unavailable', timeout ? 'The AI took too long. Try again.' : 'Could not reach the AI server.');
  }
  if (res.status === 401) throw new AiError('unauthorized', 'The AI server rejected this device token. Re-enter it in Profile → AI assistant.');
  if (res.status === 429) {
    const secs = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(secs) && secs > 0 ? (secs < 120 ? `${Math.ceil(secs)} seconds` : `${Math.ceil(secs / 60)} minutes`) : 'a while';
    throw new AiError('rate_limited', `AI limit for this phone reached. Try again in ${wait}, or log manually.`);
  }
  if (res.status === 400 || res.status === 413) throw new AiError('bad_image', 'The AI server could not use this input.');
  if (res.status === 503) {
    throw new AiError('rate_limited', 'The AI provider’s limit is used up for now (the Gemini free tier allows only a few requests a day). Try again later, or log manually.');
  }
  if (res.status === 502) throw new AiError('unavailable', 'The AI service didn’t answer (Google’s servers are sometimes busy). Try again in a minute, or log manually.');
  if (res.status !== 200) throw new AiError('unavailable', 'The AI service is unavailable right now.');
  const parsed = schema.safeParse(res.json);
  if (!parsed.success) throw new AiError('bad_response', 'The AI returned an unexpected answer.');
  return parsed.data;
}

const locale = () => (Intl.DateTimeFormat().resolvedOptions().locale.startsWith('de') ? 'de' : 'en');

export async function aiParseMeal(db: SQLiteDatabase, text: string): Promise<AiItem[]> {
  const r = await call(db, '/v1/parse-meal', { text: text.trim().slice(0, 1000), locale: locale() }, itemsResponseSchema, 30_000);
  return r.items;
}

/** Downscales to ≤1024 px JPEG (strips EXIF/location metadata) and base64-encodes it. */
async function prepareImage(uri: string): Promise<string> {
  for (const [size, compress] of [
    [1024, 0.7],
    [800, 0.5],
  ] as const) {
    const ctx = ImageManipulator.manipulate(uri);
    ctx.resize({ width: size, height: null });
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
    if (saved.base64 && saved.base64.length <= MAX_IMAGE_B64) return saved.base64;
  }
  throw new AiError('bad_image', 'This photo is too large to analyze.');
}

/** `note` is optional text the user typed to go with the photo. */
export async function aiAnalyzePlate(db: SQLiteDatabase, imageUri: string, note?: string): Promise<AiItem[]> {
  const image_base64 = await prepareImage(imageUri);
  const trimmed = note?.trim().slice(0, 500);
  const body = { mode: 'plate', image_base64, mime_type: 'image/jpeg', locale: locale(), ...(trimmed ? { note: trimmed } : {}) };
  const r = await call(db, '/v1/analyze-photo', body, itemsResponseSchema, 45_000);
  return r.items;
}

export async function aiReadLabel(db: SQLiteDatabase, imageUri: string): Promise<AiLabel | null> {
  const image_base64 = await prepareImage(imageUri);
  const r = await call(db, '/v1/analyze-photo', { mode: 'label', image_base64, mime_type: 'image/jpeg', locale: locale() }, labelResponseSchema, 45_000);
  return r.label;
}

export interface InsightsInput {
  days: number;
  nutrients: { key: string; name: string; unit: string; avg: number; target: number | null; max: number | null; daysBelowTarget: number }[];
  topFoods: { name: string; count: number }[];
}

/** Sends only aggregated averages and food names; no profile data (name, age, weight) leaves the device. */
export async function aiInsights(db: SQLiteDatabase, input: InsightsInput): Promise<AiInsight[]> {
  const r = await call(db, '/v1/insights', { ...input, locale: locale() }, insightsResponseSchema, 45_000);
  return r.insights;
}
