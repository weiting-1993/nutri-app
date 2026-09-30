import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { ACTIVITY_FACTORS } from '../../domain/targets';
import { exportBackup, pickAndImportBackup } from '../../data/backupIo';
import { getAiConfig } from '../../data/aiClient';
import { useApp, useProfile, useUserDb } from '../../state/AppContext';
import { useFocusData } from '../../state/useFocusData';
import { Button, Card, Muted, Row, styles } from '../../ui/components';
import { colors, space } from '../../ui/theme';

export default function SettingsScreen() {
  const db = useUserDb();
  const profile = useProfile();
  const { profiles, targets, setActiveProfile, reloadProfiles } = useApp();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const { data: ai } = useFocusData(useCallback(() => getAiConfig(db), [db]));

  const doExport = async () => {
    setBusy('export');
    try {
      await exportBackup(db);
    } catch {
      Alert.alert('Export failed', 'Could not create the backup file.');
    } finally {
      setBusy(null);
    }
  };

  const doImport = () =>
    Alert.alert('Import backup?', 'Entries from the backup are merged into this phone. Items with the same ID are overwritten.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Choose file',
        onPress: async () => {
          setBusy('import');
          try {
            const r = await pickAndImportBackup(db);
            if (!r) return;
            if (!r.ok) return Alert.alert('Import failed', r.error);
            await reloadProfiles();
            const c = r.counts;
            Alert.alert('Imported', `${c.profiles} profiles, ${c.entries} diary entries, ${c.customFoods} foods, ${c.savedMeals} saved meals, ${c.weights} weights.`);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{profile.name}</Text>
        <Muted>
          {profile.heightCm} cm · {profile.weightKg} kg · {ACTIVITY_FACTORS[profile.activity].label.split(' (')[0]}
        </Muted>
        <Text style={[styles.bold, { marginTop: space.sm }]}>
          {targets.energy?.min} kcal · P {targets.protein?.min} g · C {targets.carbs?.min} g · F {targets.fat?.min} g
        </Text>
        <Button title="Edit profile & targets" variant="secondary" onPress={() => router.push('/profile-edit')} style={{ marginTop: space.md }} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Profiles</Text>
        {profiles.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setActiveProfile(p.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: p.id === profile.id }}
            style={{ paddingVertical: 8 }}
          >
            <Row style={{ gap: 8 }}>
              <Text style={{ color: p.id === profile.id ? colors.primary : colors.muted, fontSize: 18 }}>{p.id === profile.id ? '●' : '○'}</Text>
              <Text style={styles.text}>{p.name}</Text>
            </Row>
          </Pressable>
        ))}
        {profiles.length < 20 ? <Button title="+ Add profile" variant="ghost" onPress={() => router.push({ pathname: '/profile-edit', params: { new: '1' } })} /> : null}
        <Muted>Each profile has its own diary, targets and weight. Custom foods are shared.</Muted>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Food</Text>
        <Button title="My foods" variant="secondary" onPress={() => router.push('/my-foods')} style={{ marginTop: space.sm }} />
        <Button title="Saved meals" variant="secondary" onPress={() => router.push('/saved-meals')} style={{ marginTop: space.sm }} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>✨ AI assistant</Text>
        <Muted>{ai?.url && ai.hasToken ? `Connected to ${ai.url.replace('https://', '')}` : 'Not set up. AI features are optional.'}</Muted>
        <Button
          title={ai?.url && ai.hasToken ? 'AI settings' : 'Set up AI'}
          variant="secondary"
          onPress={() => router.push('/ai-settings')}
          style={{ marginTop: space.sm }}
        />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Backup</Text>
        <Muted>Your data lives only on this phone. Export regularly and keep the file somewhere safe (it contains your diary and body data).</Muted>
        <Row style={{ gap: space.sm, marginTop: space.sm }}>
          <Button title="Export" style={{ flex: 1 }} onPress={doExport} loading={busy === 'export'} disabled={!!busy} />
          <Button title="Import" variant="secondary" style={{ flex: 1 }} onPress={doImport} loading={busy === 'import'} disabled={!!busy} />
        </Row>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Data sources</Text>
        <Muted style={{ marginTop: 4 }}>
          U.S. Department of Agriculture, Agricultural Research Service. FoodData Central (Foundation Foods, SR Legacy, FNDDS). Public domain.
        </Muted>
        <Muted style={{ marginTop: 4 }}>
          Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0.
          Licensed under CC BY 4.0; values converted to the app’s units (carbohydrates shown as total incl. fibre).
        </Muted>
        <Muted style={{ marginTop: 4 }}>Barcode data © Open Food Facts contributors, Open Database License (ODbL).</Muted>
        <Muted style={{ marginTop: 4 }}>Targets: US Dietary Reference Intakes (NASEM); energy via Mifflin-St Jeor. Not medical advice.</Muted>
      </Card>
    </ScrollView>
  );
}
