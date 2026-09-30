import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { formatAmount, scaleNutrients } from '../../domain/nutrients';
import { gramsFor, parseQuantity, unitsForFood, type ServingUnit } from '../../domain/servings';
import { MEAL_LABELS, MEALS, parseFoodKey, type DiaryEntry, type FoodDetail, type Meal } from '../../domain/types';
import { getFood } from '../../data/foodRepo';
import { getEntry, newId, recentFoods, saveEntry } from '../../data/userDb';
import { useApp, useFoodsDb, useProfile, useUserDb } from '../../state/AppContext';
import { useDateMealParams } from '../../state/useDateMealParams';
import { Button, Card, Empty, Field, Muted, Row, Segmented, styles } from '../../ui/components';
import { NutrientTable } from '../../ui/NutrientTable';
import { colors, space } from '../../ui/theme';

export default function FoodScreen() {
  const foodsDb = useFoodsDb();
  const userDb = useUserDb();
  const profile = useProfile();
  const { targets } = useApp();
  const params = useLocalSearchParams<{ key?: string; entryId?: string }>();
  const { date, meal: initialMeal } = useDateMealParams();
  const key = parseFoodKey(params.key);
  const entryId = typeof params.entryId === 'string' ? params.entryId : undefined;

  const [food, setFood] = useState<FoodDetail | null | undefined>(undefined);
  const [existing, setExisting] = useState<DiaryEntry | null>(null);
  const [unitId, setUnitId] = useState('g');
  const [qtyText, setQtyText] = useState('100');
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!key) return setFood(null);
      const f = await getFood(foodsDb, userDb, key);
      if (!alive) return;
      const units = f ? unitsForFood(f.portions) : [];
      const entry = entryId ? await getEntry(userDb, profile.id, entryId) : null;
      const last = entry ? null : (await recentFoods(userDb, profile.id, 200)).find((r) => r.foodKey === key);
      if (!alive) return;
      const prior = entry ?? last;
      const priorUnit = prior ? units.find((u) => u.label === prior.unitLabel) : undefined;
      if (prior && priorUnit) {
        setUnitId(priorUnit.id);
        setQtyText(String(Math.round(prior.quantity * 100) / 100));
      } else if (units[0] && units[0].id.startsWith('p:')) {
        setUnitId(units[0].id);
        setQtyText('1');
      }
      if (entry) {
        setExisting(entry);
        setMeal(entry.meal);
      }
      setFood(f);
    })();
    return () => {
      alive = false;
    };
  }, [key, entryId, foodsDb, userDb, profile.id]);

  const units = useMemo(() => (food ? unitsForFood(food.portions) : []), [food]);
  const unit: ServingUnit | undefined = units.find((u) => u.id === unitId) ?? units.find((u) => u.id === 'g');
  const qty = parseQuantity(qtyText);
  const grams = qty !== undefined && unit ? gramsFor(qty, unit) : undefined;
  const nutrients = useMemo(() => (food && grams ? scaleNutrients(food.per100g, grams) : {}), [food, grams]);

  if (food === undefined) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (food === null || !key) return <Empty>This food could not be found.</Empty>;

  const save = async () => {
    if (!grams || qty === undefined || !unit) return;
    setSaving(true);
    try {
      await saveEntry(userDb, {
        id: existing?.id ?? newId(),
        profileId: profile.id,
        date: existing?.date ?? date,
        meal,
        foodKey: key,
        name: food.name,
        quantity: qty,
        unitLabel: unit.label,
        grams,
        nutrients,
        createdAt: existing?.createdAt ?? Date.now(),
      });
      router.dismissAll();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit entry' : 'Log food' }} />
      <View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{food.name}</Text>
        <Muted>{food.subtitle}</Muted>
      </View>

      <Card>
        <Field
          label="Amount"
          value={qtyText}
          onChangeText={setQtyText}
          keyboardType="decimal-pad"
          selectTextOnFocus
          maxLength={12}
          error={qtyText && grams === undefined ? 'Enter a positive amount (max 10 kg)' : undefined}
        />
        <Text style={styles.label}>Unit</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {units.map((u) => (
            <Pressable
              key={u.id}
              onPress={() => {
                if (u.id !== unitId && grams && (u.id === 'g' || unit?.id === 'g')) {
                  // Keep the same amount of food when switching to/from grams.
                  setQtyText(String(Math.round((grams / u.grams) * 10) / 10));
                }
                setUnitId(u.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: u.id === unit?.id }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: u.id === unit?.id ? colors.primary : colors.border,
                backgroundColor: u.id === unit?.id ? '#E8F1EC' : colors.card,
              }}
            >
              <Text style={{ color: u.id === unit?.id ? colors.primary : colors.text }}>{u.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ marginTop: space.md }}>
          <Segmented options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} value={meal} onChange={setMeal} />
        </View>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-around' }}>
          <Stat label="kcal" value={formatAmount('energy', nutrients.energy)} color={colors.text} />
          <Stat label="protein" value={formatAmount('protein', nutrients.protein)} color={colors.protein} />
          <Stat label="carbs" value={formatAmount('carbs', nutrients.carbs)} color={colors.carbs} />
          <Stat label="fat" value={formatAmount('fat', nutrients.fat)} color={colors.fat} />
        </Row>
        <Muted style={{ textAlign: 'center', marginTop: space.sm }}>{grams ? `${Math.round(grams)} g` : ''}</Muted>
      </Card>

      <Button title={existing ? 'Update entry' : `Add to ${MEAL_LABELS[meal]}`} onPress={save} disabled={!grams} loading={saving} />
      {key.startsWith('custom:') ? (
        <Button title="Edit this food" variant="ghost" onPress={() => router.push({ pathname: '/custom-food', params: { id: key.slice(7) } })} />
      ) : null}

      <Text style={styles.sectionTitle}>Nutrients in this amount (% of daily target)</Text>
      <NutrientTable values={nutrients} targets={targets} />
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color }}>{value}</Text>
      <Muted>{label}</Muted>
    </View>
  );
}
