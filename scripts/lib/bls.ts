import { NUTRIENT_KEYS, type NutrientKey, type Nutrients } from '../../src/domain/nutrients.ts';

/** BLS 4.0 column code -> app nutrient key and factor into the app's unit. */
const BLS_MAP: Partial<Record<NutrientKey, { code: string; factor?: number }>> = {
  energy: { code: 'ENERCC' },
  protein: { code: 'PROT625' },
  fat: { code: 'FAT' },
  fiber: { code: 'FIBT' },
  sugars: { code: 'SUGAR' },
  satFat: { code: 'FASAT' },
  monoFat: { code: 'FAMS' },
  polyFat: { code: 'FAPU' },
  omega3: { code: 'FAPUN3' },
  omega6: { code: 'FAPUN6' },
  cholesterol: { code: 'CHORL' },
  alcohol: { code: 'ALC' },
  water: { code: 'WATER' },
  vitA: { code: 'VITAA' },
  vitC: { code: 'VITC' },
  vitD: { code: 'VITD' },
  vitE: { code: 'VITE' },
  vitK: { code: 'VITK' },
  thiamin: { code: 'THIA' },
  riboflavin: { code: 'RIBF' },
  niacin: { code: 'NIA' },
  pantothenicAcid: { code: 'PANTAC' },
  vitB6: { code: 'VITB6', factor: 1 / 1000 },
  biotin: { code: 'BIOT' },
  folate: { code: 'FOL' },
  vitB12: { code: 'VITB12' },
  calcium: { code: 'CA' },
  copper: { code: 'CU', factor: 1 / 1000 },
  iodine: { code: 'ID' },
  iron: { code: 'FE' },
  magnesium: { code: 'MG' },
  manganese: { code: 'MN', factor: 1 / 1000 },
  phosphorus: { code: 'P' },
  potassium: { code: 'K' },
  sodium: { code: 'NA' },
  zinc: { code: 'ZN' },
};

/** Expected unit per code, checked against the header to catch upstream format changes. */
const EXPECTED_UNITS: Record<string, string> = {
  ENERCC: 'kcal/100g',
  VITB6: 'µg/100g',
  CU: 'µg/100g',
  MN: 'µg/100g',
  CA: 'mg/100g',
  VITAA: 'µg/100g',
  CHO: 'g/100g',
};

export interface BlsFood {
  code: string;
  nameDe: string;
  nameEn: string;
  per100g: Nutrients;
}

/** '-' means no data; values below detection/quantification limits or traces count as 0. */
export function parseBlsValue(raw: string | undefined): number | undefined {
  const v = (raw ?? '').trim();
  if (v === '' || v === '-') return undefined;
  if (/^(<LOD|<LOQ|<LOD or <LOQ|TR)$/i.test(v)) return 0;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function blsColumnIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    const m = /^(\S+) .*\[([^\]]+)\]$/.exec(h.trim());
    if (m) {
      index.set(m[1], i);
      const expected = EXPECTED_UNITS[m[1]];
      if (expected && expected !== m[2]) throw new Error(`BLS column ${m[1]} unit changed: ${m[2]} (expected ${expected})`);
    }
  });
  for (const code of ['ENERCC', 'PROT625', 'FAT', 'CHO', 'FIBT']) {
    if (!index.has(code)) throw new Error(`BLS column ${code} missing`);
  }
  return index;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

export function mapBlsRow(row: string[], index: Map<string, number>): BlsFood | null {
  const code = row[0]?.trim();
  const nameDe = row[1]?.trim();
  if (!code || !/^[A-Z]\d{6}$/.test(code) || !nameDe) return null;

  const get = (c: string) => {
    const i = index.get(c);
    return i === undefined ? undefined : parseBlsValue(row[i]);
  };

  const per100g: Nutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const m = BLS_MAP[key];
    if (!m) continue;
    const v = get(m.code);
    if (v !== undefined) per100g[key] = round(v * (m.factor ?? 1));
  }

  // BLS reports available carbohydrate (EU style, excluding fiber); the app uses total carbohydrate.
  const cho = get('CHO');
  if (cho !== undefined) per100g.carbs = round(cho + (per100g.fiber ?? 0));

  if (per100g.energy === undefined) return null;
  return { code, nameDe, nameEn: row[2]?.trim() ?? '', per100g };
}
