import { useCallback, useMemo } from 'react';
import { ScrollView, Text } from 'react-native';
import { Stack } from 'expo-router';
import { formatDateLabel } from '../domain/dates';
import { netCarbs, sumNutrients } from '../domain/nutrients';
import { listEntries } from '../data/userDb';
import { useApp, useProfile, useUserDb } from '../state/AppContext';
import { useDateMealParams } from '../state/useDateMealParams';
import { useFocusData } from '../state/useFocusData';
import { Card, Muted, Row, styles } from '../ui/components';
import { NutrientTable } from '../ui/NutrientTable';

export default function NutrientsScreen() {
  const db = useUserDb();
  const profile = useProfile();
  const { targets } = useApp();
  const { date } = useDateMealParams();
  const { data: entries = [] } = useFocusData(useCallback(() => listEntries(db, profile.id, date), [db, profile.id, date]));
  const totals = useMemo(() => sumNutrients(entries.map((e) => e.nutrients)), [entries]);
  const v = totals.values;
  const kcal = v.energy ?? 0;
  const pct = (g: number | undefined, f: number) => (kcal > 0 && g !== undefined ? Math.round(((g * f) / kcal) * 100) : 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `Nutrients · ${formatDateLabel(date)}` }} />
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.bold}>Calories from</Text>
          <Text style={styles.text}>
            P {pct(v.protein, 4)}% · C {pct(v.carbs, 4)}% · F {pct(v.fat, 9)}%{v.alcohol ? ` · Alc ${pct(v.alcohol, 7)}%` : ''}
          </Text>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={styles.bold}>Net carbs</Text>
          <Text style={styles.text}>{Math.round(netCarbs(v) ?? 0)} g</Text>
        </Row>
        <Muted style={{ marginTop: 6 }}>
          {totals.count} item{totals.count === 1 ? '' : 's'} logged. Where some foods lack data for a nutrient, the total is a lower bound and marked.
        </Muted>
      </Card>
      <NutrientTable values={v} targets={targets} missing={totals.missing} itemCount={totals.count} />
    </ScrollView>
  );
}
