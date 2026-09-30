export interface ServingUnit {
  /** Stable id for the unit within a food: 'g', 'oz', or 'p:<index>'. */
  id: string;
  label: string;
  /** Grams in one of this unit. */
  grams: number;
}

export const GRAMS_PER_OZ = 28.349523125;
export const MAX_GRAMS_PER_ENTRY = 10_000;

export function unitsForFood(portions: { label: string; grams: number }[]): ServingUnit[] {
  const units: ServingUnit[] = portions
    .filter((p) => p.grams > 0 && Number.isFinite(p.grams))
    .map((p, i) => ({ id: `p:${i}`, label: `${p.label} (${formatGrams(p.grams)} g)`, grams: p.grams }));
  units.push({ id: 'g', label: 'g', grams: 1 }, { id: 'oz', label: 'oz', grams: GRAMS_PER_OZ });
  return units;
}

export function formatGrams(g: number): string {
  if (g >= 100) return String(Math.round(g));
  if (g >= 10) return String(Math.round(g * 10) / 10);
  return String(Math.round(g * 100) / 100);
}

/**
 * Parse a user-typed quantity: "2", "1.5", "1,5", "1/2", "1 1/2".
 * Returns undefined for invalid, zero, negative or absurd values.
 */
export function parseQuantity(input: string): number | undefined {
  const s = input.trim().replace(',', '.');
  if (!s || s.length > 20) return undefined;
  let value: number;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return undefined;
    value = Number(mixed[1]) + Number(mixed[2]) / den;
  } else if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return undefined;
    value = Number(frac[1]) / den;
  } else if (/^\d*\.?\d+$/.test(s)) {
    value = Number(s);
  } else {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) return undefined;
  return value;
}

export function gramsFor(quantity: number, unit: ServingUnit): number | undefined {
  const g = quantity * unit.grams;
  if (!Number.isFinite(g) || g <= 0 || g > MAX_GRAMS_PER_ENTRY) return undefined;
  return g;
}
