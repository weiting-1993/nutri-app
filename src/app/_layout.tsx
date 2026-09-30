import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { FOOD_DB_VERSION } from '../data/foodDbVersion';
import { migrateUserDb } from '../data/userDb';
import { AppProvider, FoodsDbBridge, useApp } from '../state/AppContext';
import { colors } from '../ui/theme';

const FOODS_ASSET = { assetId: require('../../assets/db/foods.db') };

function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

function StartupError({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Couldn’t open the app data</Text>
      <Text style={styles.errorBody}>Close and reopen the app. If this keeps happening, free up storage space.</Text>
      <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button">
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function RootStack() {
  const { loading, loadError, profile, reloadProfiles } = useApp();
  const segments = useSegments();
  if (loadError) return <StartupError onRetry={() => void reloadProfiles()} />;
  if (loading) return <Loading />;
  if (!profile && segments[0] !== 'profile-edit') return <Redirect href="/profile-edit?onboarding=1" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Diary' }} />
      <Stack.Screen name="add" options={{ title: 'Add food' }} />
      <Stack.Screen name="food/[key]" options={{ title: 'Food' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan barcode' }} />
      <Stack.Screen name="quick-add" options={{ title: 'Quick add', presentation: 'modal' }} />
      <Stack.Screen name="custom-food" options={{ title: 'Custom food' }} />
      <Stack.Screen name="profile-edit" options={{ title: 'Profile' }} />
      <Stack.Screen name="nutrients" options={{ title: 'Nutrients' }} />
      <Stack.Screen name="saved-meals" options={{ title: 'Saved meals' }} />
      <Stack.Screen name="my-foods" options={{ title: 'My foods' }} />
      <Stack.Screen name="ai-log" options={{ title: 'AI log' }} />
      <Stack.Screen name="ai-settings" options={{ title: 'AI assistant' }} />
    </Stack>
  );
}

// Non-suspense providers: expo-sqlite's suspense mode caches a single database globally,
// so two nested suspense providers keep closing each other's connection and never resolve.
export default function RootLayout() {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onError = useCallback(() => setFailed(true), []);

  if (failed) {
    return (
      <StartupError
        onRetry={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={StyleSheet.absoluteFill}>
        <Loading />
      </View>
      <SQLiteProvider key={attempt} databaseName={`foods-v${FOOD_DB_VERSION}.db`} assetSource={FOODS_ASSET} onError={onError}>
        <FoodsDbBridge>
          <SQLiteProvider databaseName="user.db" onInit={migrateUserDb} onError={onError}>
            <AppProvider>
              <RootStack />
            </AppProvider>
          </SQLiteProvider>
        </FoodsDbBridge>
      </SQLiteProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  errorTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 8, textAlign: 'center' },
  errorBody: { fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 20 },
  retry: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  retryText: { color: colors.primaryText, fontWeight: '600', fontSize: 16 },
});
