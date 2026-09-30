import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { labelToPer100g } from '../domain/ai';
import { NUTRIENT_KEYS, NUTRIENTS, sanitizeNutrients, type NutrientKey, type Nutrients } from '../domain/nutrients';
import { isValidGtin, normalizeBarcode } from '../domain/openFoodFacts';
import type { CustomFood } from '../domain/types';
import { aiReadLabel, AiError, getAiConfig } from '../data/aiClient';
import { deleteCustomFood, getCustomFood, newId, saveCustomFood } from '../data/userDb';
import { useUserDb } from '../state/AppContext';
import { Button, Card, Field, Muted, Segmented, styles } from '../ui/components';
import { space } from '../ui/theme';

const CORE: NutrientKey[] = ['energy', 'fat', 'satFat', 'carbs', 'sugars', 'fiber', 'protein'];
const MORE = NUTRIENT_KEYS.filter((k) => !CORE.includes(k) && k !== 'sodium');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Basis = '100g' | 'serving';

function toText(v: number | undefined): string {
  return v === undefined ? '' : String(Math.round(v * 100) / 100);
}

function parseValue(s: string): number | undefined | null {
  const t = s.trim().replace(',', '.');
  if (!t) return undefined;
  if (!/^\d*\.?\d+$/.test(t)) return null;
  const v = Number(t);
  return v < 1e5 ? v : null;
}

export default function CustomFoodScreen() {
  const db = useUserDb();
  const params = useLocalSearchParams<{ id?: string; barcode?: string; name?: string }>();
  const editId = typeof params.id === 'string' && UUID.test(params.id) ? params.id : undefined;
  const [existing, setExisting] = useState<CustomFood | null>(null);
  const [name, setName] = useState(typeof params.name === 'string' ? params.name.slice(0, 120) : '');
  const [brand, setBrand] = useState('');
  const [barcode, setBarcode] = useState(typeof params.barcode === 'string' ? params.barcode.replace(/\D/g, '').slice(0, 14) : '');
  const [servingLabel, setServingLabel] = useState('');
  const [servingGrams, setServingGrams] = useState('');
  const [basis, setBasis] = useState<Basis>('100g');
  const [values, setValues] = useState<Partial<Record<NutrientKey, string>>>({});
  const [salt, setSalt] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState<'ai' | 'save' | null>(null);

  const fillFromPer100g = (n: Nutrients) => {
    const v: Partial<Record<NutrientKey, string>> = {};
    for (const k of NUTRIENT_KEYS) if (n[k] !== undefined && k !== 'sodium') v[k] = toText(n[k]);
    setValues(v);
    setSalt(n.sodium !== undefined ? toText((n.sodium * 2.5) / 1000) : '');
    setBasis('100g');
  };

  useEffect(() => {
    if (!editId) return;
    getCustomFood(db, editId).then((f) => {
      if (!f) return;
      setExisting(f);
      setName(f.name);
      setBrand(f.brand);
      setBarcode(f.barcode ?? '');
      setServingLabel(f.servingLabel ?? '');
      setServingGrams(f.servingGrams ? toText(f.servingGrams) : '');
      fillFromPer100g(f.per100g);
      if (MORE.some((k) => f.per100g[k] !== undefined)) setShowMore(true);
    });
  }, [db, editId]);

  const readLabel = async (source: 'camera' | 'library') => {
    const cfg = await getAiConfig(db);
    if (!cfg.url || !cfg.hasToken) {
      Alert.alert('AI isn’t set up', 'Reading labels from photos needs your AI server. You can still type the values in.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Set up AI', onPress: () => router.push('/ai-settings') },
      ]);
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Camera access needed', 'Enable camera access in Settings.');
    }
    const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    setBusy('ai');
    try {
      const label = await aiReadLabel(db, r.assets[0].uri);
      const per100g = label ? labelToPer100g(label) : null;
      if (!label || !per100g) {
        Alert.alert('Could not read label', 'Make sure the nutrition table is sharp and fully visible, or enter the values manually.');
        return;
      }
      fillFromPer100g(per100g);
      if (label.name && !name) setName(label.name);
      if (label.brand && !brand) setBrand(label.brand);
      if (label.serving_grams) {
        setServingGrams(toText(label.serving_grams));
        if (!servingLabel) setServingLabel('1 serving');
      }
      Alert.alert('Label read', 'Please compare the values with the label before saving.');
    } catch (e) {
      Alert.alert('AI unavailable', e instanceof AiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const sGrams = parseValue(servingGrams);
  const code = barcode ? normalizeBarcode(barcode) : '';
  const errors = {
    name: name.trim() ? undefined : 'Required',
    barcode: code && !isValidGtin(code) ? 'Not a valid EAN/UPC barcode' : undefined,
    serving:
      sGrams === null || (sGrams !== undefined && (sGrams <= 0 || sGrams > 5000))
        ? 'Enter grams between 0 and 5000'
        : basis === 'serving' && !sGrams
          ? 'Required when values are per serving'
          : undefined,
    energy: parseValue(values.energy ?? '') === undefined ? 'Required' : undefined,
  };
  const badValue = [...NUTRIENT_KEYS.map((k) => values[k] ?? ''), salt].some((s) => parseValue(s) === null);
  const canSave = !Object.values(errors).some(Boolean) && !badValue;

  const save = async () => {
    if (!canSave) return;
    const factor = basis === 'serving' ? 100 / sGrams! : 1;
    const raw: Record<string, number> = {};
    for (const k of NUTRIENT_KEYS) {
      const v = parseValue(values[k] ?? '');
      if (typeof v === 'number') raw[k] = v * factor;
    }
    const saltV = parseValue(salt);
    if (typeof saltV === 'number') raw.sodium = saltV * factor * 400;
    const per100g = sanitizeNutrients(raw);
    if ((per100g.energy ?? 0) > 900 || (['protein', 'carbs', 'fat'] as const).some((k) => (per100g[k] ?? 0) > 100)) {
      Alert.alert('Check values', 'Per 100 g, calories can’t exceed 900 and protein/carbs/fat can’t exceed 100 g.');
      return;
    }
    setBusy('save');
    try {
      const now = Date.now();
      const id = existing?.id ?? newId();
      await saveCustomFood(db, {
        id,
        name: name.trim().slice(0, 120),
        brand: brand.trim().slice(0, 80),
        barcode: code || null,
        servingLabel: sGrams ? servingLabel.trim().slice(0, 60) || '1 serving' : null,
        servingGrams: sGrams ?? null,
        per100g,
        source: existing?.source ?? 'custom',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      if (existing) router.back();
      else router.replace({ pathname: '/food/[key]', params: { key: `custom:${id}` } });
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert('Delete food?', 'Diary entries that used it are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCustomFood(db, existing!.id);
          router.back();
        },
      },
    ]);

  const nutrientField = (k: NutrientKey) => (
    <Field
      key={k}
      label={`${NUTRIENTS[k].name} (${NUTRIENTS[k].unit})`}
      value={values[k] ?? ''}
      onChangeText={(t) => setValues((v) => ({ ...v, [k]: t }))}
      keyboardType="decimal-pad"
      maxLength={9}
      error={parseValue(values[k] ?? '') === null ? 'Invalid number' : k === 'energy' ? errors.energy : undefined}
    />
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Edit food' : 'New food' }} />
      <Card>
        <Text style={styles.sectionTitle}>Read a nutrition label with AI</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Button title="📷 Take photo" variant="secondary" style={{ flex: 1 }} onPress={() => readLabel('camera')} loading={busy === 'ai'} disabled={!!busy} />
          <Button title="Choose photo" variant="secondary" style={{ flex: 1 }} onPress={() => readLabel('library')} disabled={!!busy} />
        </View>
      </Card>

      <Card>
        <Field label="Name" value={name} onChangeText={setName} maxLength={120} error={errors.name} />
        <Field label="Brand (optional)" value={brand} onChangeText={setBrand} maxLength={80} />
        <Field label="Barcode (optional)" value={barcode} onChangeText={(t) => setBarcode(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={14} error={errors.barcode} />
        <Field label="Serving name (optional)" value={servingLabel} onChangeText={setServingLabel} placeholder="e.g. 1 bar" maxLength={60} />
        <Field label="Serving size (g)" value={servingGrams} onChangeText={setServingGrams} keyboardType="decimal-pad" maxLength={7} error={errors.serving} />
      </Card>

      <Card>
        <Text style={[styles.label, { marginBottom: space.sm }]}>Values are</Text>
        <Segmented<Basis>
          options={[
            { value: '100g', label: 'per 100 g / ml' },
            { value: 'serving', label: 'per serving' },
          ]}
          value={basis}
          onChange={setBasis}
        />
        <View style={{ height: space.md }} />
        {CORE.map(nutrientField)}
        <Field
          label="Salt (g)"
          value={salt}
          onChangeText={setSalt}
          keyboardType="decimal-pad"
          maxLength={9}
          hint="EU labels list salt; sodium is calculated as salt ÷ 2.5"
          error={parseValue(salt) === null ? 'Invalid number' : undefined}
        />
        <Button title={showMore ? 'Hide vitamins & minerals' : 'More nutrients (optional)'} variant="ghost" onPress={() => setShowMore((s) => !s)} />
        {showMore ? MORE.map(nutrientField) : null}
      </Card>

      <Button title="Save food" onPress={save} disabled={!canSave} loading={busy === 'save'} />
      {existing ? <Button title="Delete food" variant="danger" onPress={remove} /> : null}
      <Muted>Leave a nutrient empty if it isn’t on the label. Empty means “unknown”, not zero.</Muted>
    </ScrollView>
  );
}
