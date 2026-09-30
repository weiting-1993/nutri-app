import Constants from 'expo-constants';
import { isValidGtin, parseOffResponse, type OffProduct } from '../domain/openFoodFacts';
import { fetchJson, HttpError } from './http';

const OFF_HOST = 'https://world.openfoodfacts.org';
const FIELDS = 'product_name,product_name_en,brands,serving_size,serving_quantity,nutriments';

export type OffLookup = { kind: 'found'; product: OffProduct } | { kind: 'not_found' } | { kind: 'error'; message: string };

/** Looks up a validated barcode on Open Food Facts (public, read-only API; no credentials). */
export async function lookupBarcode(barcode: string): Promise<OffLookup> {
  if (!isValidGtin(barcode)) return { kind: 'not_found' };
  const version = Constants.expoConfig?.version ?? '1.0.0';
  try {
    const { status, json } = await fetchJson(`${OFF_HOST}/api/v2/product/${barcode}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': `NutriTracker/${version} (personal use)`, Accept: 'application/json' },
      timeoutMs: 10_000,
    });
    if (status === 404) return { kind: 'not_found' };
    if (status !== 200) return { kind: 'error', message: 'Open Food Facts is unavailable right now.' };
    const product = parseOffResponse(barcode, json);
    return product ? { kind: 'found', product } : { kind: 'not_found' };
  } catch (e) {
    const timeout = e instanceof HttpError && e.kind === 'timeout';
    return { kind: 'error', message: timeout ? 'Lookup timed out. Check your connection.' : 'Could not reach Open Food Facts.' };
  }
}
