import { describe, expect, it } from 'vitest';
import { blsColumnIndex, mapBlsRow, parseBlsValue } from '../scripts/lib/bls';

const header = [
  'BLS Code',
  'Lebensmittelbezeichnung',
  'Food name',
  'ENERCC Energie (Kilokalorien) [kcal/100g]',
  'PROT625 Protein (Nx6,25) [g/100g]',
  'FAT Fett [g/100g]',
  'CHO Kohlenhydrate, verfügbar [g/100g]',
  'FIBT Ballaststoffe, gesamt [g/100g]',
  'VITB6 Vitamin B6 [µg/100g]',
  'CU Kupfer [µg/100g]',
  'VITC Vitamin C [mg/100g]',
];

describe('BLS parsing', () => {
  it('parses values, missing markers and trace markers', () => {
    expect(parseBlsValue('1.5')).toBe(1.5);
    expect(parseBlsValue('-')).toBeUndefined();
    expect(parseBlsValue('')).toBeUndefined();
    expect(parseBlsValue('<LOD')).toBe(0);
    expect(parseBlsValue('TR')).toBe(0);
    expect(parseBlsValue('-3')).toBeUndefined();
    expect(parseBlsValue('abc')).toBeUndefined();
  });

  it('maps a row with total carbs and unit conversions', () => {
    const idx = blsColumnIndex(header);
    const f = mapBlsRow(['B511000', 'Weizenbrötchen', 'Wheat roll', '280', '10.09', '1.81', '53.97', '3.6', '90', '130', '-'], idx)!;
    expect(f.nameDe).toBe('Weizenbrötchen');
    expect(f.per100g.carbs).toBeCloseTo(57.57);
    expect(f.per100g.vitB6).toBeCloseTo(0.09);
    expect(f.per100g.copper).toBeCloseTo(0.13);
    expect(f.per100g.vitC).toBeUndefined();
  });

  it('rejects rows without a valid code or energy', () => {
    const idx = blsColumnIndex(header);
    expect(mapBlsRow(['bad', 'x', 'x', '1'], idx)).toBeNull();
    expect(mapBlsRow(['B511000', 'x', 'x', '-'], idx)).toBeNull();
  });

  it('fails loudly if units change upstream', () => {
    expect(() => blsColumnIndex(header.map((h) => h.replace('[µg/100g]', '[mg/100g]')))).toThrow(/unit changed/);
  });
});
