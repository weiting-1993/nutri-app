import { useCallback, useMemo, useState } from 'react';
import { Alert, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { addDays, formatDateLabel, mealForTime, todayKey } from '../../domain/dates';
import { formatAmount, NUTRIENTS, sumNutrients, type NutrientKey } from '../../domain/nutrients';
import { progress, status } from '../../domain/targets';
import { MEAL_LABELS, MEALS, type DiaryEntry, type Meal } from '../../domain/types';
import { copyEntries, deleteEntry, listEntries, newId, saveEntry } from '../../data/userDb';
import { useApp, useProfile, useUserDb } from '../../state/AppContext';
import { useFocusData } from '../../state/useFocusData';
import { Button, Card, Muted, ProgressBar, Row, styles } from '../../ui/components';
import { colors, space } from '../../ui/theme';

const MACROS: { key: NutrientKey; color: string }[] = [
  { key: 'protein', color: colors.protein },
  { key: 'carbs', color: colors.carbs },
  { key: 'fat', color: colors.fat },
];

const SWIPE_START = 15;
const SWIPE_DISTANCE = 60;

const HIGHLIGHTS: NutrientKey[] = ['fiber', 'sodium', 'satFat', 'potassium', 'calcium', 'iron', 'vitD', 'vitB12'];

export default function DiaryScreen() {
  const db = useUserDb();
  const profile = useProfile();
  const { profiles, targets, setActiveProfile } = useApp();
  const [date, setDate] = useState(todayKey());
  const swipe = useMemo(
    () =>
      PanResponder.create({
        // Capture only clearly horizontal drags, so vertical scrolling and taps behave as before.
        onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > SWIPE_START && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < SWIPE_DISTANCE) return;
          setDate((d) => addDays(d, g.dx < 0 ? 1 : -1));
        },
      }),
    [],
  );
  const { data: entries = [], reload } = useFocusData(useCallback(() => listEntries(db, profile.id, date), [db, profile.id, date]));

  const totals = useMemo(() => sumNutrients(entries.map((e) => e.nutrients)), [entries]);
  const byMeal = useMemo(() => {
    const m: Record<Meal, DiaryEntry[]> = { breakfast: [], lunch: [], dinner: [], snacks: [] };
    for (const e of entries) m[e.meal].push(e);
    return m;
  }, [entries]);

  const kcal = totals.values.energy ?? 0;
  const kcalTarget = targets.energy?.min ?? 0;
  const defaultMeal = date === todayKey() ? mealForTime() : 'snacks';

  const copyFromPreviousDay = async (meal?: Meal) => {
    const n = await copyEntries(db, profile.id, addDays(date, -1), date, meal);
    if (n === 0) Alert.alert('Nothing to copy', `No ${meal ? MEAL_LABELS[meal].toLowerCase() : 'entries'} on the previous day.`);
    reload();
  };

  const openEntry = (e: DiaryEntry) => {
    if (e.foodKey) router.push({ pathname: '/food/[key]', params: { key: e.foodKey, entryId: e.id, date, meal: e.meal } });
    else router.push({ pathname: '/quick-add', params: { entryId: e.id, date, meal: e.meal } });
  };

  const entryActions = (e: DiaryEntry) =>
    Alert.alert(e.name, undefined, [
      {
        text: 'Copy to today',
        onPress: async () => {
          await saveEntry(db, { ...e, id: newId(), date: todayKey(), createdAt: Date.now() });
          reload();
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteEntry(db, profile.id, e.id);
          reload();
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const previousDayLabel = date === todayKey() ? 'yesterday' : 'previous day';

  return (
    <View style={styles.screen} {...swipe.panHandlers}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: profiles.length > 1 ? profile.name : 'Diary' }} />

        {profiles.length > 1 ? (
          <Row style={{ gap: space.sm }}>
            {profiles.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => setActiveProfile(p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: p.id === profile.id }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 6,
                  borderRadius: 16,
                  backgroundColor: p.id === profile.id ? colors.primary : colors.card,
                  borderWidth: 1,
                  borderColor: p.id === profile.id ? colors.primary : colors.border,
                }}
              >
                <Text style={{ color: p.id === profile.id ? colors.primaryText : colors.text, fontWeight: '600' }}>{p.name}</Text>
              </Pressable>
            ))}
          </Row>
        ) : null}

        <Row style={{ justifyContent: 'space-between' }}>
          <Button title="‹" variant="ghost" onPress={() => setDate(addDays(date, -1))} accessibilityLabel="Previous day" />
          <Pressable onPress={() => setDate(todayKey())} accessibilityRole="button" accessibilityLabel="Go to today">
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{formatDateLabel(date)}</Text>
          </Pressable>
          <Button title="›" variant="ghost" onPress={() => setDate(addDays(date, 1))} accessibilityLabel="Next day" />
        </Row>

        <Card>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={{ fontSize: 32, fontWeight: '800', color: colors.text }}>{Math.round(kcal)}</Text>
              <Muted>of {kcalTarget} kcal</Muted>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: kcal > kcalTarget ? colors.danger : colors.primary }}>
                {Math.abs(Math.round(kcalTarget - kcal))}
              </Text>
              <Muted>{kcal > kcalTarget ? 'kcal over' : 'kcal left'}</Muted>
            </View>
          </Row>
          <View style={{ flexDirection: 'row', marginTop: space.sm }}>
            <ProgressBar fraction={kcalTarget ? kcal / kcalTarget : 0} color={colors.primary} over={kcal > kcalTarget * 1.05} />
          </View>
          <View style={{ marginTop: space.md, gap: space.sm }}>
            {MACROS.map(({ key, color }) => {
              const v = totals.values[key] ?? 0;
              const t = targets[key]?.min ?? 0;
              return (
                <View key={key}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={styles.text}>{NUTRIENTS[key].name}</Text>
                    <Text style={styles.text}>
                      {Math.round(v)} / {t} g
                    </Text>
                  </Row>
                  <View style={{ flexDirection: 'row', marginTop: 3 }}>
                    <ProgressBar fraction={t ? v / t : 0} color={color} />
                  </View>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space.md, gap: 6 }}>
            {HIGHLIGHTS.map((k) => {
              const st = status(totals.values[k], targets[k]);
              const pct = Math.round(progress(totals.values[k], targets[k]) * 100);
              const color = st === 'high' ? colors.danger : st === 'ok' ? colors.ok : colors.muted;
              return (
                <View key={k} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.bg }}>
                  <Text style={{ fontSize: 12, color }}>
                    {NUTRIENTS[k].name} {st === 'high' ? 'high' : `${pct}%`}
                  </Text>
                </View>
              );
            })}
          </View>
          <Button
            title="All nutrients"
            variant="secondary"
            style={{ marginTop: space.md }}
            onPress={() => router.push({ pathname: '/nutrients', params: { date } })}
          />
        </Card>

        <Row style={{ gap: space.sm }}>
          <Button title="Search" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/add', params: { date, meal: defaultMeal } })} />
          <Button title="Scan" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/scan', params: { date, meal: defaultMeal } })} />
          <Button title="✨ AI" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/ai-log', params: { date, meal: defaultMeal } })} />
        </Row>

        {MEALS.map((meal) => {
          const items = byMeal[meal];
          const mealKcal = items.reduce((s, e) => s + (e.nutrients.energy ?? 0), 0);
          return (
            <Card key={meal}>
              <Row style={{ justifyContent: 'space-between', marginBottom: items.length ? space.sm : 0 }}>
                <View>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{MEAL_LABELS[meal]}</Text>
                  <Muted>{Math.round(mealKcal)} kcal</Muted>
                </View>
                <Button title="+ Add" variant="secondary" onPress={() => router.push({ pathname: '/add', params: { date, meal } })} />
              </Row>
              {items.map((e) => (
                <Pressable
                  key={e.id}
                  onPress={() => openEntry(e)}
                  onLongPress={() => entryActions(e)}
                  accessibilityRole="button"
                  accessibilityHint="Tap to edit, long press for more options"
                  style={({ pressed }) => ({
                    paddingVertical: 8,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, paddingRight: space.sm }}>
                      <Text style={styles.text} numberOfLines={1}>
                        {e.name}
                      </Text>
                      <Muted>
                        {formatQuantity(e)} · P {formatAmount('protein', e.nutrients.protein)} C {formatAmount('carbs', e.nutrients.carbs)} F{' '}
                        {formatAmount('fat', e.nutrients.fat)}
                      </Muted>
                    </View>
                    <Text style={styles.bold}>{Math.round(e.nutrients.energy ?? 0)}</Text>
                  </Row>
                </Pressable>
              ))}
              <Row style={{ gap: space.md, marginTop: space.xs, flexWrap: 'wrap' }}>
                {items.length ? (
                  <MealLink
                    title="Save as meal"
                    onPress={() => router.push({ pathname: '/saved-meals', params: { fromDate: date, fromMeal: meal } })}
                  />
                ) : (
                  <MealLink title={`Copy ${previousDayLabel}’s ${MEAL_LABELS[meal].toLowerCase()}`} onPress={() => copyFromPreviousDay(meal)} />
                )}
                <MealLink title="Saved meals" onPress={() => router.push({ pathname: '/saved-meals', params: { date, meal } })} />
              </Row>
            </Card>
          );
        })}

        <Row style={{ gap: space.sm }}>
          <Button title="Quick add" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/quick-add', params: { date, meal: defaultMeal } })} />
          <Button title="Copy previous day" variant="secondary" style={{ flex: 1 }} onPress={() => copyFromPreviousDay()} />
        </Row>
      </ScrollView>
    </View>
  );
}

function MealLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
      <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

function formatQuantity(e: DiaryEntry): string {
  if (e.grams === null) return e.unitLabel || 'quick add';
  const q = Number.isInteger(e.quantity) ? e.quantity : Math.round(e.quantity * 100) / 100;
  if (e.unitLabel === 'g') return `${q} g`;
  return `${q} × ${e.unitLabel}`;
}
