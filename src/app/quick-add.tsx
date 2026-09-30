import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { Nutrients } from '../domain/nutrients';
import { MEAL_LABELS, MEALS, type DiaryEntry, type Meal } from '../domain/types';
import { getEntry, newId, saveEntry } from '../data/userDb';
import { useProfile, useUserDb } from '../state/AppContext';
import { useDateMealParams } from '../state/useDateMealParams';
import { Button, Card, Field, Muted, Segmented, styles } from '../ui/components';
import { space } from '../ui/theme';

const FIELDS = [
  { key: 'energy', label: 'Calories (kcal)', max: 10000 },
  { key: 'protein', label: 'Protein (g)', max: 1000 },
  { key: 'carbs', label: 'Carbs (g)', max: 1000 },
  { key: 'fat', label: 'Fat (g)', max: 1000 },
  { key: 'fiber', label: 'Fiber (g)', max: 500 },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];

/** Returns undefined for empty input, NaN for invalid input. */
function parseNonNegative(s: string, max: number): number | undefined {
  const t = s.trim().replace(',', '.');
  if (!t) return undefined;
  if (!/^\d*\.?\d+$/.test(t)) return NaN;
  const v = Number(t);
  return v <= max ? v : NaN;
}

export default function QuickAddScreen() {
  const db = useUserDb();
  const profile = useProfile();
  const { date, meal: initialMeal } = useDateMealParams();
  const { entryId } = useLocalSearchParams<{ entryId?: string }>();
  const [existing, setExisting] = useState<DiaryEntry | null>(null);
  const [name, setName] = useState('');
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [values, setValues] = useState<Record<FieldKey, string>>({ energy: '', protein: '', carbs: '', fat: '', fiber: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof entryId !== 'string') return;
    getEntry(db, profile.id, entryId).then((e) => {
      if (!e || e.foodKey) return;
      setExisting(e);
      setName(e.name);
      setMeal(e.meal);
      const v = (k: FieldKey) => (e.nutrients[k] !== undefined ? String(Math.round(e.nutrients[k]! * 10) / 10) : '');
      setValues({ energy: v('energy'), protein: v('protein'), carbs: v('carbs'), fat: v('fat'), fiber: v('fiber') });
    });
  }, [db, profile.id, entryId]);

  const parsed = Object.fromEntries(FIELDS.map((f) => [f.key, parseNonNegative(values[f.key], f.max)])) as Record<FieldKey, number | undefined>;
  const invalid = FIELDS.some((f) => Number.isNaN(parsed[f.key]));
  const canSave = !invalid && parsed.energy !== undefined;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const nutrients: Nutrients = {};
      for (const f of FIELDS) if (parsed[f.key] !== undefined) nutrients[f.key] = parsed[f.key];
      await saveEntry(db, {
        id: existing?.id ?? newId(),
        profileId: profile.id,
        date: existing?.date ?? date,
        meal,
        foodKey: null,
        name: name.trim().slice(0, 120) || 'Quick add',
        quantity: 1,
        unitLabel: 'quick add',
        grams: null,
        nutrients,
        createdAt: existing?.createdAt ?? Date.now(),
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit quick add' : 'Quick add' }} />
      <Card>
        <Field label="Name (optional)" value={name} onChangeText={setName} placeholder="e.g. Cake at work" maxLength={120} />
        {FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            value={values[f.key]}
            onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
            keyboardType="decimal-pad"
            maxLength={8}
            error={Number.isNaN(parsed[f.key]) ? `Enter a number from 0 to ${f.max}` : undefined}
          />
        ))}
        <View style={{ marginBottom: space.md }}>
          <Segmented options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} value={meal} onChange={setMeal} />
        </View>
        <Muted>Quick adds have no micronutrient data, so they won’t count toward vitamins and minerals.</Muted>
      </Card>
      <Button title={existing ? 'Update' : 'Add'} onPress={save} disabled={!canSave} loading={saving} />
    </ScrollView>
  );
}
