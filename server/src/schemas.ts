import { z } from 'zod';
import { sanitizeText, truncate } from './sanitize';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 1_572_864; // 1.5 MiB decoded
export const MAX_IMAGE_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
export const MAX_BODY_BYTES_PHOTO = 2_300_000; // ~2.2 MiB
export const MAX_BODY_BYTES_DEFAULT = 32_768;
export const MAX_ITEMS = 20;
export const MAX_INSIGHTS = 5;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const locale = z.enum(['de', 'en']).default('en');

/** Untrusted free text: sanitize first, then enforce length on the sanitized value. */
const cleanText = (min: number, max: number) => z.string().max(max * 2).transform(sanitizeText).pipe(z.string().min(min).max(max));

export const parseMealRequest = z
  .object({
    text: cleanText(1, 1000),
    locale,
  })
  .strict();
export type ParseMealRequest = z.infer<typeof parseMealRequest>;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodedBase64Length(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - padding;
}

function magicMatches(b64: string, mime: 'image/jpeg' | 'image/png'): boolean {
  let head: string;
  try {
    head = atob(b64.slice(0, 12)); // 9 bytes
  } catch {
    return false;
  }
  const bytes = Array.from(head, (c) => c.charCodeAt(0));
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return png.every((b, i) => bytes[i] === b);
}

export const analyzePhotoRequest = z
  .object({
    mode: z.enum(['plate', 'label']),
    image_base64: z
      .string()
      .min(16)
      .max(MAX_IMAGE_BASE64_CHARS)
      .refine((s) => s.length % 4 === 0 && BASE64_PATTERN.test(s), 'invalid base64')
      .refine((s) => decodedBase64Length(s) <= MAX_IMAGE_BYTES, 'image too large'),
    mime_type: z.enum(['image/jpeg', 'image/png']),
    /** Optional user description to go with a plate photo. */
    note: cleanText(1, 500).optional(),
    locale,
  })
  .strict()
  .refine((v) => magicMatches(v.image_base64, v.mime_type), { message: 'image content does not match mime_type' })
  .refine((v) => v.mode === 'plate' || v.note === undefined, { message: 'note is only allowed for plate photos' });
export type AnalyzePhotoRequest = z.infer<typeof analyzePhotoRequest>;

const finite = (min: number, max: number) => z.number().finite().min(min).max(max);

export const insightsRequest = z
  .object({
    days: z.number().int().min(1).max(31),
    nutrients: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-zA-Z0-9]{1,30}$/),
            name: cleanText(1, 40),
            unit: cleanText(0, 5),
            avg: finite(0, 1_000_000),
            target: finite(0, 1_000_000).nullable(),
            max: finite(0, 1_000_000).nullable(),
            daysBelowTarget: z.number().int().min(0).max(31),
          })
          .strict(),
      )
      .max(60),
    topFoods: z
      .array(
        z
          .object({
            name: cleanText(1, 120),
            count: z.number().int().min(0).max(100_000),
          })
          .strict(),
      )
      .max(30),
    locale,
  })
  .strict()
  .refine((v) => v.nutrients.every((n) => n.daysBelowTarget <= v.days), { message: 'daysBelowTarget exceeds days' });
export type InsightsRequest = z.infer<typeof insightsRequest>;

// ---------------------------------------------------------------------------
// Model output schemas (the model is untrusted too)
// ---------------------------------------------------------------------------

/** Model text: sanitize, clamp to `max` (JSON Schema mode cannot enforce maxLength), require non-empty. */
const modelText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => truncate(sanitizeText(s), max))
    .pipe(z.string().min(1));

const nullableModelText = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullable()
    .transform((s) => (s === null ? null : truncate(sanitizeText(s), max) || null));

const macro100 = finite(0, 100).nullable();

/** An implausible estimate (e.g. 60 g protein + 60 g fat per 100 g) is dropped, not the whole item. */
const per100gEstimate = z
  .object({
    energy_kcal: finite(0, 900),
    protein_g: macro100,
    carbs_g: macro100,
    fat_g: macro100,
    fiber_g: macro100,
    sugars_g: macro100,
    sat_fat_g: macro100,
    sodium_mg: finite(0, 40_000).nullable(),
  })
  .refine((v) => (v.protein_g ?? 0) + (v.carbs_g ?? 0) + (v.fat_g ?? 0) <= 100)
  .nullable()
  .catch(null);

const foodItem = z.object({
  name_en: modelText(120),
  name_de: modelText(120),
  quantity: finite(0, 10_000),
  unit: modelText(20),
  grams_estimate: finite(0, 5_000).nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  per_100g: per100gEstimate,
});

/** Longer lists are cut, not rejected: the model schema carries no maxItems (see itemsJsonSchema). */
export const itemsOutput = z.object({
  items: z
    .array(foodItem)
    .max(MAX_ITEMS * 5)
    .transform((items) => items.slice(0, MAX_ITEMS)),
});
export type ItemsOutput = z.infer<typeof itemsOutput>;

const per100 = finite(0, 1_000).nullable();

export const labelOutput = z.object({
  label: z
    .object({
      name: nullableModelText(120),
      brand: nullableModelText(120),
      basis: z.enum(['100g', '100ml', 'serving']),
      serving_grams: finite(0, 5_000).nullable(),
      energy_kcal: finite(0, 1_000).nullable(),
      protein_g: per100,
      carbs_g: per100,
      sugars_g: per100,
      fat_g: per100,
      sat_fat_g: per100,
      fiber_g: per100,
      salt_g: per100,
      sodium_mg: finite(0, 100_000).nullable(),
    })
    .nullable(),
});
export type LabelOutput = z.infer<typeof labelOutput>;

export const insightsOutput = z.object({
  insights: z
    .array(
      z.object({
        title: modelText(80),
        body: modelText(400),
        kind: z.enum(['gap', 'excess', 'positive', 'tip']),
      }),
    )
    .max(MAX_INSIGHTS),
});
export type InsightsOutput = z.infer<typeof insightsOutput>;

// ---------------------------------------------------------------------------
// JSON Schemas sent to the model (Gemini supported subset: type, enum, items,
// minItems/maxItems, minimum/maximum, properties, required, additionalProperties,
// description; nullable via a type array containing "null").
// ---------------------------------------------------------------------------

const nullableNumber = (description: string, maximum: number) => ({
  type: ['number', 'null'],
  minimum: 0,
  maximum,
  description,
});

export const itemsJsonSchema = {
  type: 'object',
  properties: {
    // No maxItems: combined with per_100g it makes Gemini reject the request (400 INVALID_ARGUMENT,
    // verified live on gemini-3.5-flash-lite and gemini-3.8-flash). itemsOutput enforces MAX_ITEMS.
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name_en: { type: 'string', description: 'Generic database-style English food name, e.g. "bread roll, wheat".' },
          name_de: { type: 'string', description: 'German food name as used in the German BLS database, e.g. "Brötchen, Weizen".' },
          quantity: { type: 'number', description: 'Amount in the given unit.' },
          unit: { type: 'string', description: 'Household unit: piece, slice, cup, tbsp, tsp, g, ml, serving, bowl, glass.' },
          grams_estimate: { type: ['number', 'null'], description: 'Best estimate of total grams (ml for drinks) for this line, or null.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          // Bounds are enforced by `itemsOutput`, keeping this schema small.
          per_100g: {
            type: 'object',
            description: 'Estimated nutrients per 100 g (100 ml for drinks) of this food as prepared. energy_kcal null if unknown.',
            properties: {
              energy_kcal: { type: ['number', 'null'] },
              protein_g: { type: ['number', 'null'] },
              carbs_g: { type: ['number', 'null'] },
              fat_g: { type: ['number', 'null'] },
              fiber_g: { type: ['number', 'null'] },
              sugars_g: { type: ['number', 'null'] },
              sat_fat_g: { type: ['number', 'null'] },
              sodium_mg: { type: ['number', 'null'] },
            },
            required: ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugars_g', 'sat_fat_g', 'sodium_mg'],
            additionalProperties: false,
          },
        },
        required: ['name_en', 'name_de', 'quantity', 'unit', 'grams_estimate', 'confidence', 'per_100g'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export const labelJsonSchema = {
  type: 'object',
  properties: {
    label: {
      type: ['object', 'null'],
      description: 'null if the image does not show a nutrition facts table.',
      properties: {
        name: { type: ['string', 'null'], description: 'Product name if visible.' },
        brand: { type: ['string', 'null'], description: 'Brand if visible.' },
        basis: { type: 'string', enum: ['100g', '100ml', 'serving'], description: 'Reference amount of the values.' },
        serving_grams: nullableNumber('Serving size in grams/ml if printed.', 5000),
        energy_kcal: nullableNumber('Energy in kcal. If only kJ is printed, kJ / 4.184.', 1000),
        protein_g: nullableNumber('Eiweiß / protein in g.', 1000),
        carbs_g: nullableNumber('Kohlenhydrate / carbohydrate in g.', 1000),
        sugars_g: nullableNumber('davon Zucker / sugars in g.', 1000),
        fat_g: nullableNumber('Fett / fat in g.', 1000),
        sat_fat_g: nullableNumber('davon gesättigte Fettsäuren / saturated fat in g.', 1000),
        fiber_g: nullableNumber('Ballaststoffe / fibre in g.', 1000),
        salt_g: nullableNumber('Salz / salt in g.', 1000),
        sodium_mg: nullableNumber('Sodium in mg, only if printed.', 100000),
      },
      required: [
        'name',
        'brand',
        'basis',
        'serving_grams',
        'energy_kcal',
        'protein_g',
        'carbs_g',
        'sugars_g',
        'fat_g',
        'sat_fat_g',
        'fiber_g',
        'salt_g',
        'sodium_mg',
      ],
      additionalProperties: false,
    },
  },
  required: ['label'],
  additionalProperties: false,
} as const;

export const insightsJsonSchema = {
  type: 'object',
  properties: {
    insights: {
      type: 'array',
      maxItems: MAX_INSIGHTS,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short headline, max 80 characters.' },
          body: { type: 'string', description: 'Practical, food-based suggestion, max 400 characters.' },
          kind: { type: 'string', enum: ['gap', 'excess', 'positive', 'tip'] },
        },
        required: ['title', 'body', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['insights'],
  additionalProperties: false,
} as const;
