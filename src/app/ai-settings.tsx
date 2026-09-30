import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { aiParseMeal, AiError, clearAiConfig, getAiConfig, saveAiConfig, type AiConfig } from '../data/aiClient';
import { useUserDb } from '../state/AppContext';
import { Button, Card, Field, Muted, styles } from '../ui/components';
import { space } from '../ui/theme';

export default function AiSettingsScreen() {
  const db = useUserDb();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  useEffect(() => {
    getAiConfig(db).then((c) => {
      setConfig(c);
      setUrl(c.url ?? '');
    });
  }, [db]);

  const save = async () => {
    setBusy('save');
    try {
      // An empty token field keeps the stored token.
      const err = await saveAiConfig(db, url, token.trim() ? token : config?.hasToken ? null : '');
      setError(err ?? undefined);
      if (!err) {
        setToken('');
        setConfig(await getAiConfig(db));
        Alert.alert('Saved', 'The device token is stored in the phone’s secure keychain.');
      }
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const items = await aiParseMeal(db, '1 apple');
      Alert.alert('Connection works', items.length ? `Recognized: ${items[0].name_en}` : 'Server answered.');
    } catch (e) {
      Alert.alert('Test failed', e instanceof AiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const clear = () =>
    Alert.alert('Remove AI setup?', 'The device token is deleted from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await clearAiConfig(db);
          router.back();
        },
      },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.text}>
          AI features call your own server (a Cloudflare Worker that holds the Gemini API key). The app never contains the API key. Each phone gets its own device token,
          which you can revoke on the server. See server/README.md for setup.
        </Text>
      </Card>
      <Card>
        <Field
          label="Server address"
          value={url}
          onChangeText={setUrl}
          placeholder="https://nutri-ai.<you>.workers.dev"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={200}
          error={error}
        />
        <Field
          label="Device token"
          value={token}
          onChangeText={setToken}
          placeholder={config?.hasToken ? '•••••••• (stored, leave empty to keep)' : 'Paste token from gen-token'}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          maxLength={128}
        />
        <Button title="Save" onPress={save} loading={busy === 'save'} disabled={!!busy || !url.trim()} />
        {config?.url && config.hasToken ? (
          <Button title="Test connection" variant="secondary" onPress={test} loading={busy === 'test'} disabled={!!busy} style={{ marginTop: space.sm }} />
        ) : null}
      </Card>
      {config?.url || config?.hasToken ? <Button title="Remove AI setup" variant="danger" onPress={clear} /> : null}
      <Muted>What is sent: meal descriptions you type, photos you choose (resized, without location data), and weekly nutrient averages. Never your name, age or weight.</Muted>
    </ScrollView>
  );
}
