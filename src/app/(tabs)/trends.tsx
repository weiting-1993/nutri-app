import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { addDays, dateRange, fromDateKey, todayKey } from '../../domain/dates';
import { formatAmount, NUTRIENTS } from '../../domain/nutrients';
import { excesses, shortfalls, summarizeRange } from '../../domain/trends';
import type { AiInsight } from '../../domain/ai';
import { aiInsights, AiError } from '../../data/aiClient';
import { deleteWeight, listEntriesInRange, listWeights, newId, saveProfile, saveWeight } from '../../data/userDb';
import { useApp, useProfile, useUserDb } from '../../state/AppContext';
import { useFocusData } from '../../state/useFocusData';
import { BarChart, LineChart } from '../../ui/Charts';
import { Button, Card, Field, Muted, Row, Segmented, styles } from '../../ui/components';
import { colors, space } from '../../ui/theme';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];

const shortDate = (key: string) => fromDateKey(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export default function TrendsScreen() {
  const db = useUserDb();
  const profile = useProfile();
  const { targets, reloadProfiles } = useApp();
  const [range, setRange] = useState('7');
  const [weightText, setWeightText] = useState('');
  const [insights, setInsights] = useState<AiInsight[] | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const days = Number(range);
  const today = todayKey();

  const { data } = useFocusData(
    useCallback(async () => {
      const [entries, weights] = await Promise.all([listEntriesInRange(db, profile.id, addDays(today, -days), today), listWeights(db, profile.id)]);
      return { entries, weights: [...weights].sort((a, b) => a.date.localeCompare(b.date)) };
    }, [db, profile.id, days, today]),
  );

  const chart = useMemo(() => summarizeRange(data?.entries ?? [], dateRange(today, days), targets), [data, today, days, targets]);
  // Averages exclude today, which is usually still incomplete.
  const summary = useMemo(() => summarizeRange(data?.entries ?? [], dateRange(addDays(today, -1), days), targets), [data, today, days, targets]);
  const lows = shortfalls(summary.avg, targets).slice(0, 6);
  const highs = excesses(summary.avg, targets).slice(0, 4);
  const weights = data?.weights ?? [];
  const recentWeights = weights.slice(-60);

  const addWeight = async () => {
    const kg = Number(weightText.replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) return Alert.alert('Invalid weight', 'Enter a weight between 30 and 300 kg.');
    await saveWeight(db, { id: newId(), profileId: profile.id, date: today, kg: Math.round(kg * 10) / 10 });
    // Keep calorie targets in sync with the latest weight.
    await saveProfile(db, { ...profile, weightKg: Math.round(kg * 10) / 10 }, profile.createdAt);
    await reloadProfiles();
    setWeightText('');
  };

  const removeWeight = (id: string, label: string) =>
    Alert.alert(`Delete weight from ${label}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteWeight(db, profile.id, id);
          await reloadProfiles();
        },
      },
    ]);

  const getInsights = async () => {
    if (summary.daysLogged < 3) return Alert.alert('Not enough data', 'Log at least 3 days to get insights.');
    setLoadingAi(true);
    try {
      const nutrients = Object.entries(targets)
        .filter(([k]) => summary.avg[k as keyof typeof summary.avg] !== undefined)
        .map(([k, t]) => {
          const key = k as keyof typeof NUTRIENTS;
          return {
            key,
            name: NUTRIENTS[key].name,
            unit: NUTRIENTS[key].unit.slice(0, 5),
            avg: Math.round((summary.avg[key] ?? 0) * 100) / 100,
            target: t?.min ?? null,
            max: t?.max ?? null,
            daysBelowTarget: summary.daysBelow[key] ?? 0,
          };
        });
      setInsights(await aiInsights(db, { days: summary.daysLogged, nutrients, topFoods: summary.topFoods }));
    } catch (e) {
      Alert.alert('AI unavailable', e instanceof AiError ? e.message : 'Something went wrong.');
    } finally {
      setLoadingAi(false);
    }
  };

  const latest = weights[weights.length - 1];
  const weekAgo = [...weights].reverse().find((w) => w.date <= addDays(today, -7));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.sectionTitle}>Weight</Text>
        <Row style={{ gap: space.sm, marginTop: space.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Today (kg)" value={weightText} onChangeText={setWeightText} keyboardType="decimal-pad" maxLength={5} placeholder={latest ? String(latest.kg) : ''} />
          </View>
          <Button title="Save" onPress={addWeight} disabled={!weightText.trim()} />
        </Row>
        {latest ? (
          <Muted>
            Latest {latest.kg} kg{weekAgo ? ` · ${latest.kg - weekAgo.kg >= 0 ? '+' : ''}${(latest.kg - weekAgo.kg).toFixed(1)} kg vs a week ago` : ''}
          </Muted>
        ) : (
          <Muted>Weigh yourself at the same time each day (e.g. mornings) for comparable trends.</Muted>
        )}
        {recentWeights.length > 1 ? <LineChart points={recentWeights.map((w) => ({ label: shortDate(w.date), value: w.kg }))} unit="kg" /> : null}
        {recentWeights
          .slice(-5)
          .reverse()
          .map((w) => (
            <Pressable key={w.id} onLongPress={() => removeWeight(w.id, shortDate(w.date))} accessibilityHint="Long press to delete">
              <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                <Muted>{shortDate(w.date)}</Muted>
                <Text style={styles.text}>{w.kg} kg</Text>
              </Row>
            </Pressable>
          ))}
      </Card>

      <Segmented options={RANGES} value={range} onChange={setRange} />

      <Card>
        <Text style={styles.sectionTitle}>Calories</Text>
        <BarChart bars={chart.energyByDay.map((d) => ({ label: shortDate(d.date), value: d.kcal }))} target={targets.energy?.min} />
        <Muted>
          Average {Math.round(summary.avg.energy ?? 0)} kcal over {summary.daysLogged} logged day{summary.daysLogged === 1 ? '' : 's'} (target{' '}
          {targets.energy?.min}). Today is excluded from averages.
        </Muted>
        <Row style={{ justifyContent: 'space-around', marginTop: space.md }}>
          {(['protein', 'carbs', 'fat', 'fiber'] as const).map((k) => (
            <View key={k} style={{ alignItems: 'center' }}>
              <Text style={styles.bold}>
                {formatAmount(k, summary.avg[k])} / {targets[k]?.min ?? '–'}
              </Text>
              <Muted>{NUTRIENTS[k].name} (g)</Muted>
            </View>
          ))}
        </Row>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Watch list</Text>
        {summary.daysLogged === 0 ? <Muted>No logged days in this range yet.</Muted> : null}
        {lows.map(({ key, fraction }) => (
          <Row key={key} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={styles.text}>{NUTRIENTS[key].name}</Text>
            <Text style={{ color: colors.warn }}>{Math.round(fraction * 100)}% of target</Text>
          </Row>
        ))}
        {highs.map(({ key, fraction }) => (
          <Row key={key} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
            <Text style={styles.text}>{NUTRIENTS[key].name}</Text>
            <Text style={{ color: colors.danger }}>{Math.round(fraction * 100)}% of limit</Text>
          </Row>
        ))}
        {summary.daysLogged > 0 && !lows.length && !highs.length ? <Muted>All tracked nutrients average at least 70% of target. Nice.</Muted> : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>✨ AI insights</Text>
        <Muted>Sends only nutrient averages and food names for this range, no name, age or weight.</Muted>
        <Button title="Get insights" variant="secondary" onPress={getInsights} loading={loadingAi} style={{ marginTop: space.sm }} />
        {insights?.map((i, idx) => (
          <View key={idx} style={{ marginTop: space.md }}>
            <Text style={[styles.bold, { color: i.kind === 'excess' ? colors.danger : i.kind === 'gap' ? colors.warn : colors.ok }]}>{i.title}</Text>
            <Text style={styles.text}>{i.body}</Text>
          </View>
        ))}
        {insights && insights.length === 0 ? <Muted style={{ marginTop: space.sm }}>No suggestions this time.</Muted> : null}
      </Card>
    </ScrollView>
  );
}
