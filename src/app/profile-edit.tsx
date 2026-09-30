import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  ACTIVITY_FACTORS,
  ageFromBirthYear,
  bmr,
  computeTargets,
  DEFAULT_MACROS,
  macroSplitValid,
  tdee,
  type ActivityLevel,
  type Profile,
  type Sex,
} from '../domain/targets';
import { deleteProfile, newId, saveProfile } from '../data/userDb';
import { useApp, useUserDb } from '../state/AppContext';
import { Button, Card, Field, Muted, Row, Segmented, styles } from '../ui/components';
import { colors, space } from '../ui/theme';

const GOALS = [
  { value: '-0.5', label: 'Lose 0.5' },
  { value: '-0.25', label: 'Lose 0.25' },
  { value: '0', label: 'Maintain' },
  { value: '0.25', label: 'Gain 0.25' },
];

const MACRO_PRESETS = [
  { value: '25/45/30', label: 'Balanced' },
  { value: '30/40/30', label: 'High protein' },
  { value: '30/25/45', label: 'Low carb' },
];

function intIn(s: string, min: number, max: number): number | undefined {
  const v = Number(s.trim().replace(',', '.'));
  return s.trim() && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

export default function ProfileEditScreen() {
  const db = useUserDb();
  const { profiles, profile: active, reloadProfiles, setActiveProfile } = useApp();
  const params = useLocalSearchParams<{ onboarding?: string; new?: string }>();
  const onboarding = params.onboarding === '1' || !active;
  const creating = onboarding || params.new === '1';
  const base = creating ? null : active;

  const [name, setName] = useState(base?.name ?? '');
  const [sex, setSex] = useState<Sex>(base?.sex ?? 'female');
  const [birthYear, setBirthYear] = useState(base ? String(base.birthYear) : '');
  const [height, setHeight] = useState(base ? String(base.heightCm) : '');
  const [weight, setWeight] = useState(base ? String(base.weightKg) : '');
  const [activity, setActivity] = useState<ActivityLevel>(base?.activity ?? 'light');
  const [goal, setGoal] = useState(String(base?.goalRateKgPerWeek ?? 0));
  const [protein, setProtein] = useState(String(base?.macros.proteinPct ?? DEFAULT_MACROS.proteinPct));
  const [carbs, setCarbs] = useState(String(base?.macros.carbsPct ?? DEFAULT_MACROS.carbsPct));
  const [fat, setFat] = useState(String(base?.macros.fatPct ?? DEFAULT_MACROS.fatPct));
  const [kcalOverride, setKcalOverride] = useState(base?.overrides.energy ? String(base.overrides.energy) : '');
  const [saving, setSaving] = useState(false);

  const thisYear = new Date().getFullYear();
  const parsed = {
    birthYear: intIn(birthYear, thisYear - 110, thisYear - 14),
    height: intIn(height, 100, 250),
    weight: intIn(weight, 30, 300),
    macros: { proteinPct: Number(protein), carbsPct: Number(carbs), fatPct: Number(fat) },
    kcal: kcalOverride.trim() ? intIn(kcalOverride, 800, 6000) : null,
  };
  const errors = {
    name: name.trim() ? undefined : 'Required',
    birthYear: parsed.birthYear ? undefined : `Year between ${thisYear - 110} and ${thisYear - 14}`,
    height: parsed.height ? undefined : '100–250 cm',
    weight: parsed.weight ? undefined : '30–300 kg',
    macros: macroSplitValid(parsed.macros) ? undefined : 'Percentages must add up to 100',
    kcal: parsed.kcal === undefined ? '800–6000 kcal, or leave empty' : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);

  const draft: Profile | null = valid
    ? {
        id: base?.id ?? '',
        name: name.trim().slice(0, 40),
        sex,
        birthYear: parsed.birthYear!,
        heightCm: parsed.height!,
        weightKg: parsed.weight!,
        activity,
        goalRateKgPerWeek: Number(goal),
        macros: parsed.macros,
        overrides: { ...(base?.overrides ?? {}), energy: parsed.kcal ?? undefined },
      }
    : null;
  if (draft && parsed.kcal === null) delete draft.overrides.energy;
  const preview = draft ? computeTargets(draft) : null;
  const age = parsed.birthYear ? ageFromBirthYear(parsed.birthYear) : 0;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const id = base?.id ?? newId();
      await saveProfile(db, { ...draft, id }, base?.createdAt);
      await reloadProfiles();
      if (creating) await setActiveProfile(id);
      if (onboarding) router.replace('/');
      else router.back();
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    Alert.alert(`Delete ${base!.name}?`, 'This deletes their diary, weights and saved meals. Export a backup first if unsure.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteProfile(db, base!.id);
          await reloadProfiles();
          router.back();
        },
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: onboarding ? 'Welcome' : creating ? 'New profile' : 'Edit profile', headerBackVisible: !onboarding }} />
      {onboarding ? <Text style={styles.text}>Set up your profile to get personal calorie and nutrient targets. Everything stays on this phone.</Text> : null}
      <Card>
        <Field label="Name" value={name} onChangeText={setName} maxLength={40} error={errors.name} />
        <Text style={styles.label}>Sex (for BMR and nutrient targets)</Text>
        <Segmented<Sex>
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
          value={sex}
          onChange={setSex}
        />
        <View style={{ height: space.md }} />
        <Field label="Birth year" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" maxLength={4} error={birthYear ? errors.birthYear : undefined} />
        <Row style={{ gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Height (cm)" value={height} onChangeText={setHeight} keyboardType="decimal-pad" maxLength={5} error={height ? errors.height : undefined} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Weight (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" maxLength={5} error={weight ? errors.weight : undefined} />
          </View>
        </Row>
      </Card>

      <Card>
        <Text style={[styles.label, { marginBottom: space.sm }]}>Activity</Text>
        {(Object.keys(ACTIVITY_FACTORS) as ActivityLevel[]).map((a) => (
          <Pressable
            key={a}
            onPress={() => setActivity(a)}
            accessibilityRole="radio"
            accessibilityState={{ checked: a === activity }}
            style={{ paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Text style={{ color: a === activity ? colors.primary : colors.muted, fontSize: 18 }}>{a === activity ? '●' : '○'}</Text>
            <Text style={styles.text}>{ACTIVITY_FACTORS[a].label}</Text>
          </Pressable>
        ))}
        <Text style={[styles.label, { marginVertical: space.sm }]}>Goal (kg per week)</Text>
        <Segmented options={GOALS} value={goal} onChange={setGoal} />
      </Card>

      <Card>
        <Text style={[styles.label, { marginBottom: space.xs }]}>Macro split (% of calories)</Text>
        <Muted style={{ marginBottom: space.sm }}>
          How your calories divide between protein, carbs and fat. Not sure? Keep Balanced. Pick High protein if you’re losing
          weight or strength training; Low carb only if you prefer eating that way. You can change it any time.
        </Muted>
        <Segmented
          options={MACRO_PRESETS}
          value={`${protein}/${carbs}/${fat}`}
          onChange={(v) => {
            const [p, c, f] = v.split('/');
            setProtein(p);
            setCarbs(c);
            setFat(f);
          }}
        />
        <View style={{ height: space.sm }} />
        <Row style={{ gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Protein %" value={protein} onChangeText={setProtein} keyboardType="number-pad" maxLength={3} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Carbs %" value={carbs} onChangeText={setCarbs} keyboardType="number-pad" maxLength={3} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Fat %" value={fat} onChangeText={setFat} keyboardType="number-pad" maxLength={3} />
          </View>
        </Row>
        {errors.macros ? <Text style={styles.error}>{errors.macros}</Text> : null}
        <Field
          label="Calorie target override (optional)"
          value={kcalOverride}
          onChangeText={setKcalOverride}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="Calculated automatically"
          error={errors.kcal}
        />
      </Card>

      {draft && preview ? (
        <Card>
          <Text style={styles.sectionTitle}>Your daily targets</Text>
          <Muted>
            BMR {Math.round(bmr(draft, age))} kcal · TDEE {Math.round(tdee(draft, age))} kcal
          </Muted>
          <Text style={[styles.bold, { marginTop: space.sm }]}>
            {preview.energy?.min} kcal · P {preview.protein?.min} g · C {preview.carbs?.min} g · F {preview.fat?.min} g
          </Text>
          {preview.protein?.min ? (
            <Muted>
              Protein ≈ {(preview.protein.min / draft.weightKg).toFixed(1)} g per kg body weight (1.2–1.6 helps keep muscle while
              losing weight or training).
            </Muted>
          ) : null}
          <Muted>Vitamin and mineral targets use US Dietary Reference Intakes for your age and sex.</Muted>
        </Card>
      ) : null}

      <Button title={onboarding ? 'Start tracking' : 'Save'} onPress={save} disabled={!valid} loading={saving} />
      {!creating && profiles.length > 1 ? <Button title="Delete profile" variant="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}
