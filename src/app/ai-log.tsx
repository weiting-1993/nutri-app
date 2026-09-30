import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { aiEstimatePer100g, type AiItem } from '../domain/ai';
import { scaleNutrients, type Nutrients } from '../domain/nutrients';
import { MAX_GRAMS_PER_ENTRY } from '../domain/servings';
import { MEAL_LABELS, MEALS, type FoodDetail, type FoodSearchResult, type Meal } from '../domain/types';
import { aiAnalyzePlate, aiParseMeal, AiError, getAiConfig } from '../data/aiClient';
import { getFood, searchFoods } from '../data/foodRepo';
import { newId, saveEntry } from '../data/userDb';
import { useFoodsDb, useProfile, useUserDb } from '../state/AppContext';
import { useDateMealParams } from '../state/useDateMealParams';
import { useFocusData } from '../state/useFocusData';
import { Button, Card, Muted, Row, Segmented, styles } from '../ui/components';
import { colors, space } from '../ui/theme';

/** `chosen` is AI_ESTIMATE or an index into `candidates`. */
const AI_ESTIMATE = -1;

interface Proposal {
  ai: AiItem;
  aiPer100: Nutrients | null;
  candidates: FoodSearchResult[];
  chosen: number;
  detail: FoodDetail | null;
  /** Grams of the portion the AI described (e.g. "1 plate"), the base for the serving buttons. */
  portionGrams: number | undefined;
  gramsText: string;
  include: boolean;
}

const SERVING_FACTORS: [number, string][] = [
  [0.5, '½ ×'],
  [1, '1 ×'],
  [1.5, '1½ ×'],
  [2, '2 ×'],
];

function portionLine(per100: Nutrients, grams: number): string {
  const n = scaleNutrients(per100, grams);
  const g = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v)} g`);
  return `${Math.round(n.energy ?? 0)} kcal · P ${g(n.protein)} · C ${g(n.carbs)} · F ${g(n.fat)}`;
}

function per100Of(p: Proposal): Nutrients | null {
  return p.chosen === AI_ESTIMATE ? p.aiPer100 : (p.detail?.per100g ?? null);
}

function macroLine(n: Nutrients): string {
  const g = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v)} g`);
  return `${Math.round(n.energy ?? 0)} kcal · P ${g(n.protein)} · C ${g(n.carbs)} · F ${g(n.fat)} per 100 g`;
}

function estimateGrams(ai: AiItem, detail: FoodDetail | null): number | undefined {
  if (ai.grams_estimate && ai.grams_estimate > 0) return ai.grams_estimate;
  const unit = ai.unit.toLowerCase();
  if (unit === 'g' || unit === 'ml') return ai.quantity;
  const portion = detail?.portions.find((p) => p.label.toLowerCase().includes(unit));
  return portion ? portion.grams * ai.quantity : undefined;
}

function Option({ checked, onPress, title, subtitle }: { checked: boolean; onPress: () => void; title: string; subtitle: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      style={{
        padding: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: checked ? colors.primary : colors.border,
        backgroundColor: checked ? '#E8F1EC' : colors.card,
      }}
    >
      <Text style={styles.text} numberOfLines={1}>
        {title}
      </Text>
      <Muted>{subtitle}</Muted>
    </Pressable>
  );
}

export default function AiLogScreen() {
  const foodsDb = useFoodsDb();
  const userDb = useUserDb();
  const profile = useProfile();
  const params = useDateMealParams();
  const [meal, setMeal] = useState<Meal>(params.meal);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'text' | 'camera' | 'library' | 'save' | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const { data: aiConfig } = useFocusData(useCallback(() => getAiConfig(userDb), [userDb]));
  const aiReady = !!aiConfig?.url && aiConfig.hasToken;

  const buildProposals = async (items: AiItem[]) => {
    const out: Proposal[] = [];
    for (const ai of items) {
      let candidates: FoodSearchResult[] = [];
      for (const name of [ai.name_de, ai.name_en]) {
        if (!name) continue;
        const found = await searchFoods(foodsDb, userDb, name);
        for (const f of found.slice(0, 3)) if (!candidates.some((c) => c.key === f.key)) candidates.push(f);
      }
      candidates = candidates.slice(0, 4);
      const detail = candidates[0] ? await getFood(foodsDb, userDb, candidates[0].key) : null;
      const aiPer100 = aiEstimatePer100g(ai);
      const g = estimateGrams(ai, detail);
      out.push({
        ai,
        aiPer100,
        candidates,
        chosen: aiPer100 ? AI_ESTIMATE : 0,
        detail,
        portionGrams: g,
        gramsText: g ? String(Math.round(g)) : '',
        include: !!aiPer100 || candidates.length > 0,
      });
    }
    setProposals(out);
    if (items.length === 0) Alert.alert('No foods found', 'Try describing the meal differently.');
  };

  const run = async (kind: 'text' | 'camera' | 'library', task: () => Promise<AiItem[]>) => {
    setBusy(kind);
    try {
      await buildProposals(await task());
    } catch (e) {
      Alert.alert('AI unavailable', e instanceof AiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const analyzeText = () => text.trim() && run('text', () => aiParseMeal(userDb, text));

  const analyzePhoto = async (source: 'camera' | 'library') => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Camera access needed', 'Enable camera access in Settings.');
    }
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    run(source, () => aiAnalyzePlate(userDb, uri, text));
  };

  const update = (i: number, patch: Partial<Proposal>) => setProposals((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const choose = async (i: number, idx: number) => {
    const p = proposals[i];
    if (idx === AI_ESTIMATE) return update(i, { chosen: AI_ESTIMATE, include: true });
    const detail = await getFood(foodsDb, userDb, p.candidates[idx].key);
    const g = p.portionGrams ?? estimateGrams(p.ai, detail);
    update(i, { chosen: idx, detail, portionGrams: g, gramsText: p.gramsText || (g ? String(Math.round(g)) : ''), include: true });
  };

  const gramsOf = (p: Proposal) => {
    const g = Number(p.gramsText.replace(',', '.'));
    return Number.isFinite(g) && g > 0 && g <= MAX_GRAMS_PER_ENTRY ? g : undefined;
  };
  const selected = proposals.filter((p) => p.include && per100Of(p));
  const invalid = selected.some((p) => gramsOf(p) === undefined);
  const totalKcal = selected.reduce((s, p) => s + (gramsOf(p) ? ((per100Of(p)!.energy ?? 0) * gramsOf(p)!) / 100 : 0), 0);

  const logAll = async () => {
    if (invalid || selected.length === 0) return;
    setBusy('save');
    try {
      const now = Date.now();
      for (const [i, p] of selected.entries()) {
        const grams = gramsOf(p)!;
        const fromAi = p.chosen === AI_ESTIMATE;
        await saveEntry(userDb, {
          id: newId(),
          profileId: profile.id,
          date: params.date,
          meal,
          foodKey: fromAi ? null : p.detail!.key,
          name: fromAi ? `${p.ai.name_en} (AI estimate)` : p.detail!.name,
          quantity: Math.round(grams),
          unitLabel: 'g',
          grams,
          nutrients: scaleNutrients(per100Of(p)!, grams),
          createdAt: now + i,
        });
      }
      router.dismissAll();
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: 'AI log',
          headerRight: () => (
            <Pressable onPress={() => router.push('/ai-settings')} hitSlop={8} accessibilityRole="button" accessibilityLabel="AI settings">
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>Settings</Text>
            </Pressable>
          ),
        }}
      />
      <Segmented options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} value={meal} onChange={setMeal} />
      {aiConfig && !aiReady ? (
        <Card>
          <Text style={styles.bold}>AI isn’t set up yet</Text>
          <Muted style={{ marginVertical: space.xs }}>
            AI logging needs your own AI server address and device token. Everything else in the app works without it.
          </Muted>
          <Button title="Set up AI" onPress={() => router.push('/ai-settings')} />
        </Card>
      ) : null}
      <Card>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={'e.g. "2 Brötchen mit Butter und Käse, Kaffee mit Milch"'}
          placeholderTextColor={colors.muted}
          multiline
          maxLength={1000}
          style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
          accessibilityLabel="Describe what you ate"
        />
        <Muted style={{ marginTop: 4 }}>
          Tip: tap the microphone on your keyboard to dictate. Text you type here is also sent with a photo (e.g. the dish name or “half eaten”).
        </Muted>
        <Button
          title="Analyze description"
          onPress={analyzeText}
          loading={busy === 'text'}
          disabled={!aiReady || !text.trim() || !!busy}
          style={{ marginTop: space.sm }}
        />
        <Row style={{ gap: space.sm, marginTop: space.sm }}>
          <Button
            title="📷 Take photo"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => analyzePhoto('camera')}
            loading={busy === 'camera'}
            disabled={!aiReady || !!busy}
          />
          <Button
            title="🖼️ From library"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => analyzePhoto('library')}
            loading={busy === 'library'}
            disabled={!aiReady || !!busy}
          />
        </Row>
        <Muted style={{ marginTop: space.sm }}>
          Text and photos are sent to your AI server (Google Gemini) for analysis. Portions and AI nutrient values are estimates. Check them before logging.
        </Muted>
      </Card>

      {proposals.map((p, i) => (
        <Card key={i}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bold}>
                {p.ai.quantity} {p.ai.unit} {p.ai.name_en}
              </Text>
              {p.ai.confidence !== 'high' ? <Text style={{ color: colors.warn, fontSize: 12 }}>{p.ai.confidence} confidence: please check</Text> : null}
            </View>
            <Switch
              value={p.include}
              onValueChange={(v) => update(i, { include: v })}
              disabled={!p.aiPer100 && !p.candidates.length}
              accessibilityLabel="Include item"
            />
          </Row>
          {!p.aiPer100 && p.candidates.length === 0 ? (
            <Muted>No nutrient estimate or database match. Add it manually from search.</Muted>
          ) : (
            <View style={{ gap: 6, marginTop: space.sm }}>
              {p.aiPer100 ? (
                <Option checked={p.chosen === AI_ESTIMATE} onPress={() => choose(i, AI_ESTIMATE)} title="AI estimate" subtitle={macroLine(p.aiPer100)} />
              ) : null}
              {p.candidates.length ? <Muted style={{ marginTop: 2 }}>{p.aiPer100 ? 'Or use lab-measured values from the database:' : 'Database matches:'}</Muted> : null}
              {p.candidates.map((c, idx) => (
                <Option key={c.key} checked={idx === p.chosen} onPress={() => choose(i, idx)} title={c.name} subtitle={c.subtitle} />
              ))}
              <Text style={[styles.bold, { marginTop: space.xs }]}>Amount you ate</Text>
              <Muted>
                {p.portionGrams
                  ? `AI guess: ${p.ai.quantity} ${p.ai.unit} ≈ ${Math.round(p.portionGrams)} g. Tap how many of those you had, or type the weight if you weighed it.`
                  : 'The AI couldn’t guess the weight. Type the grams you ate.'}
              </Muted>
              {p.portionGrams ? (
                <Row style={{ gap: 6 }}>
                  {SERVING_FACTORS.map(([factor, label]) => {
                    const grams = String(Math.round(p.portionGrams! * factor));
                    const active = p.gramsText === grams;
                    return (
                      <Pressable
                        key={label}
                        onPress={() => update(i, { gramsText: grams })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${label} portion, ${grams} grams`}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          paddingVertical: 8,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? '#E8F1EC' : colors.card,
                        }}
                      >
                        <Text style={styles.text}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </Row>
              ) : null}
              <Row style={{ gap: space.sm }}>
                <TextInput
                  value={p.gramsText}
                  onChangeText={(t) => update(i, { gramsText: t })}
                  keyboardType="decimal-pad"
                  maxLength={6}
                  placeholder="grams"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { width: 100 }, p.include && !gramsOf(p) ? { borderColor: colors.danger } : null]}
                  accessibilityLabel="Grams eaten"
                />
                <Muted style={{ flex: 1 }}>g{per100Of(p) && gramsOf(p) ? ` = ${portionLine(per100Of(p)!, gramsOf(p)!)}` : ''}</Muted>
              </Row>
            </View>
          )}
        </Card>
      ))}

      {selected.length ? (
        <Button
          title={`Log ${selected.length} item${selected.length > 1 ? 's' : ''} · ${Math.round(totalKcal)} kcal`}
          onPress={logAll}
          disabled={invalid}
          loading={busy === 'save'}
        />
      ) : null}
    </ScrollView>
  );
}
