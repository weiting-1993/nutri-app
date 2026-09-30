import { useCallback } from 'react';
import { FlatList, Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { listCustomFoods } from '../data/userDb';
import { useUserDb } from '../state/AppContext';
import { useFocusData } from '../state/useFocusData';
import { Button, Empty, Muted, styles } from '../ui/components';
import { colors } from '../ui/theme';

export default function MyFoodsScreen() {
  const db = useUserDb();
  const { data: foods = [] } = useFocusData(useCallback(() => listCustomFoods(db), [db]));
  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.content}
      data={foods}
      keyExtractor={(f) => f.id}
      ListHeaderComponent={<Button title="+ New food" onPress={() => router.push('/custom-food')} />}
      ListEmptyComponent={<Empty>Foods you create or scan appear here. They’re shared by both profiles.</Empty>}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/custom-food', params: { id: item.id } })}
          accessibilityRole="button"
          style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Text style={styles.text}>{item.name}</Text>
          <Muted>
            {[item.brand, item.source === 'off' ? 'Open Food Facts' : 'Custom', `${Math.round(item.per100g.energy ?? 0)} kcal/100 g`].filter(Boolean).join(' · ')}
          </Muted>
        </Pressable>
      )}
    />
  );
}
