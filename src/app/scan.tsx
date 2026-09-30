import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { isValidGtin, normalizeBarcode } from '../domain/openFoodFacts';
import { findCustomFoodByBarcode, newId, saveCustomFood } from '../data/userDb';
import { lookupBarcode } from '../data/openFoodFactsClient';
import { useUserDb } from '../state/AppContext';
import { useDateMealParams } from '../state/useDateMealParams';
import { Button, Muted, styles } from '../ui/components';
import { colors, space } from '../ui/theme';

export default function ScanScreen() {
  const db = useUserDb();
  const { date, meal } = useDateMealParams();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const handling = useRef(false);

  const openFood = (id: string) => router.replace({ pathname: '/food/[key]', params: { key: `custom:${id}`, date, meal } });

  const onScanned = async ({ data }: BarcodeScanningResult) => {
    if (handling.current) return;
    const code = normalizeBarcode(data);
    if (!isValidGtin(code)) return;
    handling.current = true;
    setBusy(true);
    try {
      const local = await findCustomFoodByBarcode(db, code);
      if (local) return openFood(local.id);

      const result = await lookupBarcode(code);
      if (result.kind === 'found') {
        const p = result.product;
        const now = Date.now();
        const id = newId();
        await saveCustomFood(db, {
          id,
          name: p.name,
          brand: p.brand,
          barcode: code,
          servingLabel: p.servingLabel ?? null,
          servingGrams: p.servingGrams ?? null,
          per100g: p.per100g,
          source: 'off',
          createdAt: now,
          updatedAt: now,
        });
        if (p.warnings.length) {
          Alert.alert('Check this product', `${p.warnings.join('\n')}\n\nYou can fix values via "Edit this food".`, [
            { text: 'OK', onPress: () => openFood(id) },
          ]);
        } else {
          openFood(id);
        }
        return;
      }
      const message = result.kind === 'error' ? result.message : 'This product is not in Open Food Facts yet.';
      Alert.alert('Product not found', message, [
        { text: 'Scan again', onPress: () => (handling.current = false) },
        { text: 'Enter from label', onPress: () => router.replace({ pathname: '/custom-food', params: { barcode: code } }) },
      ]);
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return <ActivityIndicator style={{ marginTop: 40 }} />;
  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.content]}>
        <Text style={styles.text}>Camera access is needed to scan barcodes. Images are processed on the device only.</Text>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Muted>Enable camera access for this app in your phone’s Settings.</Muted>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ title: 'Scan barcode' }} />
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onBarcodeScanned={busy ? undefined : onScanned}
      />
      <View style={{ position: 'absolute', left: 40, right: 40, top: '35%', height: 140, borderWidth: 2, borderColor: '#fff', borderRadius: 12 }} />
      <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: space.sm }}>
        {busy ? <ActivityIndicator color="#fff" /> : null}
        <Text style={{ color: '#fff', fontSize: 15 }}>{busy ? 'Looking up product…' : 'Point at a barcode'}</Text>
        <Button title="Enter manually" variant="secondary" onPress={() => router.replace('/custom-food')} />
      </View>
      <View style={{ position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: colors.card, borderRadius: 8, paddingHorizontal: 8 }}>
        <Muted>Data: Open Food Facts (ODbL)</Muted>
      </View>
    </View>
  );
}
