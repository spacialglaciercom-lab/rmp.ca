import { View, StyleSheet, Platform } from "react-native";
import Svg, { Line } from "react-native-svg";

import { useColors } from "@/hooks/use-colors";

/**
 * Subtle circuit-board style overlay: horizontal and vertical traces in cyan/magenta.
 * Renders at ~10–15% opacity for background texture.
 */
export function CircuitBackground() {
  const colors = useColors();
  const cyan = colors.primary ?? "#00d9ff";
  const magenta = colors.accentMagenta ?? "#d946ef";
  const opacity = 0.12;

  const lines: { x1: number; y1: number; x2: number; y2: number; stroke: string }[] = [];
  const w = 400;
  const h = 600;
  const step = 48;
  for (let x = 0; x < w; x += step) {
    lines.push({ x1: x, y1: 0, x2: x, y2: h, stroke: cyan });
  }
  for (let y = 0; y < h; y += step) {
    lines.push({ x1: 0, y1: y, x2: w, y2: y, stroke: magenta });
  }

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
        {lines.map((l, i) => (
          <Line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={l.stroke}
            strokeOpacity={opacity}
            strokeWidth={1}
          />
        ))}
      </Svg>
    </View>
  );
}
