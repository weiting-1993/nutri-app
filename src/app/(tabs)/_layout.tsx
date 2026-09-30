import { Text, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { colors } from '../../ui/theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Diary', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: icon('↗') }} />
      <Tabs.Screen name="settings" options={{ title: 'Profile', tabBarIcon: icon('◉') }} />
    </Tabs>
  );
}
