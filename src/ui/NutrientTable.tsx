import { Text, View } from 'react-native';
import {
  formatAmount,
  GROUP_LABELS,
  GROUP_ORDER,
  NUTRIENT_KEYS,
  NUTRIENTS,
  type NutrientKey,
  type Nutrients,
} from '../domain/nutrients';
import { progress, status, type Targets } from '../domain/targets';
import { Card, ProgressBar, SectionTitle } from './components';
import { colors } from './theme';

const BAR_COLORS: Partial<Record<NutrientKey, string>> = {
  energy: colors.energy,
  protein: colors.protein,
  carbs: colors.carbs,
  fat: colors.fat,
};

export function NutrientTable({
  values,
  targets,
  missing,
  itemCount,
}: {
  values: Nutrients;
  targets: Targets;
  /** Per-nutrient count of items lacking data (for daily totals). */
  missing?: Partial<Record<NutrientKey, number>>;
  itemCount?: number;
}) {
  return (
    <View style={{ gap: 12 }}>
      {GROUP_ORDER.map((group) => {
        const keys = NUTRIENT_KEYS.filter((k) => NUTRIENTS[k].group === group);
        return (
          <Card key={group}>
            <SectionTitle>{GROUP_LABELS[group]}</SectionTitle>
            {keys.map((k) => (
              <NutrientRow key={k} k={k} value={values[k]} target={targets[k]} missing={missing?.[k]} itemCount={itemCount} />
            ))}
          </Card>
        );
      })}
    </View>
  );
}

function NutrientRow({
  k,
  value,
  target,
  missing,
  itemCount,
}: {
  k: NutrientKey;
  value: number | undefined;
  target: Targets[NutrientKey];
  missing?: number;
  itemCount?: number;
}) {
  const def = NUTRIENTS[k];
  const st = status(value, target);
  const pct = target?.min ? Math.round(((value ?? 0) / target.min) * 100) : undefined;
  const color = st === 'high' ? colors.danger : st === 'ok' ? colors.ok : BAR_COLORS[k] ?? colors.primary;
  const incomplete = missing && itemCount ? `${missing}/${itemCount} items have no data` : undefined;

  return (
    <View style={{ paddingVertical: 6 }} accessibilityLabel={`${def.name} ${formatAmount(k, value)} ${def.unit}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: 14 }}>{def.name}</Text>
        <Text style={{ color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] }}>
          {formatAmount(k, value)} {def.unit}
          {target?.min !== undefined ? <Text style={{ color: colors.muted }}> / {formatAmount(k, target.min)}</Text> : null}
          {pct !== undefined ? <Text style={{ color, fontWeight: '600' }}>  {pct}%</Text> : null}
        </Text>
      </View>
      {target?.min !== undefined ? (
        <View style={{ flexDirection: 'row', marginTop: 4 }}>
          <ProgressBar fraction={progress(value, target)} color={color} over={st === 'high'} />
        </View>
      ) : null}
      {st === 'high' && target?.max !== undefined ? (
        <Text style={{ color: colors.danger, fontSize: 11, marginTop: 2 }}>
          Above upper limit ({formatAmount(k, target.max)} {def.unit})
        </Text>
      ) : null}
      {incomplete ? <Text style={{ color: colors.warn, fontSize: 11, marginTop: 2 }}>{incomplete}</Text> : null}
    </View>
  );
}
