import { NUTRIENT_KEYS, type NutrientKey, type Nutrients } from './nutrients';
import type { Targets } from './targets';
import type { DiaryEntry } from './types';

export interface RangeSummary {
  dates: string[];
  /** kcal per date (0 for unlogged days). */
  energyByDay: { date: string; kcal: number }[];
  daysLogged: number;
  /** Average per logged day. */
  avg: Nutrients;
  /** Logged days where the nutrient was below its min target. */
  daysBelow: Partial<Record<NutrientKey, number>>;
  topFoods: { name: string; count: number }[];
}

/** Only days with at least one entry count, so forgetting to log doesn't look like a deficiency. */
export function summarizeRange(entries: DiaryEntry[], dates: string[], targets: Targets): RangeSummary {
  const byDay = new Map<string, Nutrients>();
  const foodCounts = new Map<string, number>();
  for (const e of entries) {
    const day = byDay.get(e.date) ?? {};
    for (const k of NUTRIENT_KEYS) {
      const v = e.nutrients[k];
      if (v !== undefined) day[k] = (day[k] ?? 0) + v;
    }
    byDay.set(e.date, day);
    foodCounts.set(e.name, (foodCounts.get(e.name) ?? 0) + 1);
  }
  const logged = dates.filter((d) => byDay.has(d));
  const avg: Nutrients = {};
  const daysBelow: Partial<Record<NutrientKey, number>> = {};
  if (logged.length) {
    for (const k of NUTRIENT_KEYS) {
      let sum = 0;
      let seen = false;
      let below = 0;
      for (const d of logged) {
        const v = byDay.get(d)![k];
        if (v !== undefined) {
          sum += v;
          seen = true;
        }
        const min = targets[k]?.min;
        if (min !== undefined && (v ?? 0) < min) below++;
      }
      if (seen) avg[k] = sum / logged.length;
      if (targets[k]?.min !== undefined) daysBelow[k] = below;
    }
  }
  const topFoods = [...foodCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));
  return {
    dates,
    energyByDay: dates.map((d) => ({ date: d, kcal: byDay.get(d)?.energy ?? 0 })),
    daysLogged: logged.length,
    avg,
    daysBelow,
    topFoods,
  };
}

/** Nutrients whose average is furthest below target (fraction < threshold), worst first. */
export function shortfalls(avg: Nutrients, targets: Targets, threshold = 0.7): { key: NutrientKey; fraction: number }[] {
  const out: { key: NutrientKey; fraction: number }[] = [];
  for (const k of NUTRIENT_KEYS) {
    const min = targets[k]?.min;
    if (!min || k === 'energy') continue;
    const f = (avg[k] ?? 0) / min;
    if (f < threshold) out.push({ key: k, fraction: f });
  }
  return out.sort((a, b) => a.fraction - b.fraction);
}

export function excesses(avg: Nutrients, targets: Targets): { key: NutrientKey; fraction: number }[] {
  const out: { key: NutrientKey; fraction: number }[] = [];
  for (const k of NUTRIENT_KEYS) {
    const max = targets[k]?.max;
    if (max && (avg[k] ?? 0) > max) out.push({ key: k, fraction: avg[k]! / max });
  }
  return out.sort((a, b) => b.fraction - a.fraction);
}
