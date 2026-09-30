import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { isDateKey } from '../domain/dates';
import { MEAL_LABELS, MEALS, type Meal, type SavedMeal } from '../domain/types';
import { deleteSavedMeal, listEntries, listSavedMeals, logSavedMeal, newId, saveSavedMeal } from '../data/userDb';
import { useProfile, useUserDb } from '../state/AppContext';
import { useDateMealParams } from '../state/useDateMealParams';
import { useFocusData } from '../state/useFocusData';
import { Button, Card, Empty, Field, Muted, styles } from '../ui/components';
import { colors, space } from '../ui/theme';

export default function SavedMealsScreen() {
  const db = useUserDb();
  const profile = useProfile();
  const { date, meal } = useDateMealParams();
  const raw = useLocalSearchParams<{ fromDate?: string; fromMeal?: string }>();
  const fromDate = typeof raw.fromDate === 'string' && isDateKey(raw.fromDate) ? raw.fromDate : null;
  const fromMeal = (MEALS as readonly string[]).includes(raw.fromMeal ?? '') ? (raw.fromMeal as Meal) : null;
  const creating = !!(fromDate && fromMeal);

  const { data: meals = [], reload } = useFocusData(useCallback(() => listSavedMeals(db, profile.id), [db, profile.id]));
  const { data: sourceEntries = [] } = useFocusData(
    useCallback(
      async () => (fromDate && fromMeal ? (await listEntries(db, profile.id, fromDate)).filter((e) => e.meal === fromMeal).slice(0, 100) : []),
      [db, profile.id, fromDate, fromMeal],
    ),
  );
  /** Entry ids the user unticked; everything else is included. */
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const picked = sourceEntries.filter((e) => !excluded.has(e.id));
  const [name, setName] = useState(fromMeal ? MEAL_LABELS[fromMeal] : '');
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) =>
    setExcluded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    if (!fromDate || !fromMeal || !name.trim() || picked.length === 0) return;
    setSaving(true);
    try {
      await saveSavedMeal(db, {
        id: newId(),
        profileId: profile.id,
        name: name.trim().slice(0, 80),
        items: picked.map(({ foodKey, name: n, quantity, unitLabel, grams, nutrients }) => ({ foodKey, name: n, quantity, unitLabel, grams, nutrients })),
        createdAt: Date.now(),
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const log = async (m: SavedMeal) => {
    await logSavedMeal(db, m, date, meal);
    router.dismissAll();
  };

  const remove = (m: SavedMeal) =>
    Alert.alert(`Delete "${m.name}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSavedMeal(db, profile.id, m.id);
          reload();
        },
      },
    ]);

  if (creating) {
    const kcal = picked.reduce((s, e) => s + (e.nutrients.energy ?? 0), 0);
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: 'Save meal' }} />
        <Card>
          <Field label="Name" value={name} onChangeText={setName} maxLength={80} placeholder="e.g. Usual breakfast" />
          <Muted>Tick the foods to include. You can then log them again with one tap.</Muted>
        </Card>
        <Card>
          {sourceEntries.map((e, i) => {
            const on = !excluded.has(e.id);
            return (
              <Pressable
                key={e.id}
                onPress={() => toggle(e.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {on ? <Text style={{ color: colors.primaryText, fontSize: 14, fontWeight: '800' }}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.text, !on && { color: colors.muted }]} numberOfLines={1}>
                    {e.name}
                  </Text>
                  <Muted>{Math.round(e.nutrients.energy ?? 0)} kcal</Muted>
                </View>
              </Pressable>
            );
          })}
        </Card>
        <Button
          title={picked.length ? `Save ${picked.length} food${picked.length > 1 ? 's' : ''} · ${Math.round(kcal)} kcal` : 'Tick at least one food'}
          onPress={create}
          disabled={!name.trim() || picked.length === 0}
          loading={saving}
        />
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={meals}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={<Stack.Screen options={{ title: `Saved meals → ${MEAL_LABELS[meal]}` }} />}
      ListEmptyComponent={<Empty>No saved meals yet. In the diary, tap “Save as meal” under a meal that has foods in it.</Empty>}
      renderItem={({ item }) => {
        const kcal = item.items.reduce((s, i) => s + (i.nutrients.energy ?? 0), 0);
        return (
          <Pressable onPress={() => log(item)} onLongPress={() => remove(item)} accessibilityRole="button" accessibilityHint="Tap to log, long press to delete">
            <Card style={{ marginBottom: space.sm }}>
              <Text style={styles.bold}>{item.name}</Text>
              <Muted>
                {item.items.length} items · {Math.round(kcal)} kcal
              </Muted>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                {item.items.map((i) => i.name).join(', ')}
              </Text>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
