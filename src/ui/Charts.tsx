import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from './theme';

const H = 160;
const PAD = { l: 34, r: 8, t: 10, b: 20 };

export function LineChart({ points, unit }: { points: { label: string; value: number }[]; unit: string }) {
  const [w, setW] = useState(0);
  if (points.length === 0) return null;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const x = (i: number) => PAD.l + (points.length === 1 ? (w - PAD.l - PAD.r) / 2 : (i / (points.length - 1)) * (w - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: H }} accessibilityLabel={`Chart of ${points.length} values in ${unit}`}>
      {w > 0 ? (
        <Svg width={w} height={H}>
          {[lo, (lo + hi) / 2, hi].map((v) => (
            <SvgText key={v} x={2} y={y(v) + 4} fontSize={10} fill={colors.muted}>
              {v.toFixed(1)}
            </SvgText>
          ))}
          <Line x1={PAD.l} x2={w - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke={colors.border} />
          <Polyline points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} fill="none" stroke={colors.primary} strokeWidth={2} />
          {points.map((p, i) => (
            <Circle key={i} cx={x(i)} cy={y(p.value)} r={3} fill={colors.primary} />
          ))}
          <SvgText x={PAD.l} y={H - 4} fontSize={10} fill={colors.muted}>
            {points[0].label}
          </SvgText>
          <SvgText x={w - PAD.r} y={H - 4} fontSize={10} fill={colors.muted} textAnchor="end">
            {points[points.length - 1].label}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}

export function BarChart({ bars, target }: { bars: { label: string; value: number }[]; target?: number }) {
  const [w, setW] = useState(0);
  const hi = Math.max(1, target ?? 0, ...bars.map((b) => b.value)) * 1.1;
  const innerW = w - PAD.l - PAD.r;
  const bw = bars.length ? innerW / bars.length : 0;
  const y = (v: number) => PAD.t + (1 - v / hi) * (H - PAD.t - PAD.b);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height: H }}>
      {w > 0 ? (
        <Svg width={w} height={H}>
          <SvgText x={2} y={y(hi / 1.1) + 4} fontSize={10} fill={colors.muted}>
            {Math.round(hi / 1.1)}
          </SvgText>
          {bars.map((b, i) => {
            const over = target !== undefined && b.value > target * 1.05;
            return (
              <Rect
                key={i}
                x={PAD.l + i * bw + bw * 0.15}
                y={y(b.value)}
                width={bw * 0.7}
                height={Math.max(0, H - PAD.b - y(b.value))}
                rx={2}
                fill={b.value === 0 ? colors.track : over ? colors.warn : colors.primary}
              />
            );
          })}
          {target ? <Line x1={PAD.l} x2={w - PAD.r} y1={y(target)} y2={y(target)} stroke={colors.danger} strokeDasharray="4 3" /> : null}
          {bars.length ? (
            <>
              <SvgText x={PAD.l} y={H - 4} fontSize={10} fill={colors.muted}>
                {bars[0].label}
              </SvgText>
              <SvgText x={w - PAD.r} y={H - 4} fontSize={10} fill={colors.muted} textAnchor="end">
                {bars[bars.length - 1].label}
              </SvgText>
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
