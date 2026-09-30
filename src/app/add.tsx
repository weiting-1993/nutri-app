import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { MEAL_LABELS, MEALS, type FoodSearchResult, type Meal } from '../domain/types';
import { searchFoods } from '../data/foodRepo';
import { newId, recentFoods, saveEntry, type RecentFood } from '../data/userDb';
import { useFoodsDb, useProfile, useUserDb } from '../state/AppContext';
import { useDateMealParams } from '../state/useDateMealParams';
import { useFocusData } from '../state/useFocusData';
import { Button, Muted, Row, Segmented, styles } from '../ui/components';
import { colors, space } from '../ui/theme';

function logRecent(db: SQLiteDatabase, profileId: string, date: string, meal: Meal, r: RecentFood) {
  return saveEntry(db, {
    id: newId(),
    profileId,
    date,
    meal,
    foodKey: r.foodKey,
    name: r.name,
    quantity: r.quantity,
    unitLabel: r.unitLabel,
    grams: r.grams,
    nutrients: r.nutrients,
    createdAt: Date.now(),
  });
}

export default function AddFoodScreen() {
  const foodsDb = useFoodsDb();
  const userDb = useUserDb();
  const profile = useProfile();
  const params = useDateMealParams();
  const [meal, setMeal] = useState<Meal>(params.meal);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  const { data: recents = [], reload: reloadRecents } = useFocusData(useCallback(() => recentFoods(userDb, profile.id, 40), [userDb, profile.id]));
  const preferred = useMemo(
    () => new Set(recents.flatMap((r) => (r.foodKey && r.uses >= 2 ? [r.foodKey] : []))),
    [recents],
  );

  useEffect(() => {
    const q = query.trim();
    // Results for short queries are hidden (recents are shown instead), so nothing to clear here.
    if (q.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchFoods(foodsDb, userDb, q.slice(0, 100), preferred);
        if (id === seq.current) setResults(r);
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, foodsDb, userDb, preferred]);

  const openFood = (key: string) => router.push({ pathname: '/food/[key]', params: { key, date: params.date, meal } });

  const relog = async (r: RecentFood) => {
    await logRecent(userDb, profile.id, params.date, meal, r);
    reloadRecents();
    router.back();
  };

  const showRecents = query.trim().length < 2;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Add to ${MEAL_LABELS[meal]}` }} />
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Segmented options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} value={meal} onChange={setMeal} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search foods (English or Deutsch)"
          placeholderTextColor={colors.muted}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          maxLength={100}
          accessibilityLabel="Search foods"
        />
        <Row style={{ gap: space.sm }}>
          <Button title="Scan" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/scan', params: { date: params.date, meal } })} />
          <Button title="✨ AI" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/ai-log', params: { date: params.date, meal } })} />
          <Button title="Quick" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/quick-add', params: { date: params.date, meal } })} />
          <Button title="Meals" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/saved-meals', params: { date: params.date, meal } })} />
        </Row>
      </View>

      {showRecents ? (
        <FlatList
          data={recents}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}
          ListHeaderComponent={
            <View style={{ marginBottom: space.sm }}>
              <Text style={styles.sectionTitle}>Recent</Text>
              <Muted>Tap + to log the same amount again, including AI-logged foods.</Muted>
            </View>
          }
          ListEmptyComponent={<Muted>Foods you log will appear here for one-tap logging.</Muted>}
          renderItem={({ item }) => (
            <Row style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Pressable
                style={{ flex: 1 }}
                onPress={() => (item.foodKey ? openFood(item.foodKey) : relog(item))}
                accessibilityRole="button"
                accessibilityHint={item.foodKey ? 'Opens the food to choose an amount' : 'Logs it again with the same amount'}
              >
                <Text style={styles.text} numberOfLines={1}>
                  {item.name}
                </Text>
                <Muted>
                  {item.grams === null
                    ? item.unitLabel || 'quick add'
                    : item.unitLabel === 'g'
                      ? `${Math.round(item.quantity)} g`
                      : `${item.quantity} × ${item.unitLabel}`}{' '}
                  · {Math.round(item.nutrients.energy ?? 0)} kcal
                </Muted>
              </Pressable>
              <Button title="+" variant="secondary" onPress={() => relog(item)} accessibilityLabel={`Log ${item.name} again`} />
            </Row>
          )}
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}
          ListEmptyComponent={
            searching ? null : (
              <View style={{ gap: space.sm }}>
                <Muted>No matches. Try another word, or:</Muted>
                <Button title="Create custom food" variant="secondary" onPress={() => router.push({ pathname: '/custom-food', params: { name: query.trim() } })} />
              </View>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openFood(item.key)}
              accessibilityRole="button"
              style={({ pressed }) => ({ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, opacity: pressed ? 0.6 : 1 })}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: space.sm }}>
                  <Text style={styles.text} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Muted>{item.subtitle}</Muted>
                </View>
                <Muted>{item.energyPer100g !== undefined ? `${Math.round(item.energyPer100g)} kcal/100g` : ''}</Muted>
              </Row>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
