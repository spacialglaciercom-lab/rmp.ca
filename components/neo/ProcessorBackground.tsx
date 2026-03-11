/**
 * Processor-style background: microprocessor chip aesthetic with traces, pads, and components
 * Replaces the checkered circuit pattern with a more modern processor design
 */

import { View, StyleSheet, Platform, Dimensions } from "react-native";
import Svg, {
  Line,
  Rect,
  Circle,
  Path,
  G,
  Defs,
  LinearGradient,
  Stop,
  Polygon,
} from "react-native-svg";

import { useColors } from "@/hooks/use-colors";

export function ProcessorBackground() {
  const colors = useColors();
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

  // Processor color scheme
  const copper = "#B87333";
  const gold = "#FFD700";
  const silver = "#C0C0C0";
  const silicon = colors.background;
  const traceOpacity = 0.15;
  const componentOpacity = 0.25;

  // Generate processor traces
  const generateTraces = () => {
    const traces: React.ReactElement[] = [];
    const gridSize = 40;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 3;

    // Central processor die area
    const dieSize = 120;
    const dieX = centerX - dieSize / 2;
    const dieY = centerY - dieSize / 2;

    // Main processor traces - horizontal and vertical
    for (let i = 0; i < 12; i++) {
      const y = dieY + (i * dieSize) / 12;
      traces.push(
        <Line
          key={`h-trace-${i}`}
          x1={dieX - 80}
          y1={y}
          x2={dieX + dieSize + 80}
          y2={y}
          stroke={copper}
          strokeOpacity={traceOpacity}
          strokeWidth={i % 3 === 0 ? 2 : 1}
        />,
      );
    }

    for (let i = 0; i < 12; i++) {
      const x = dieX + (i * dieSize) / 12;
      traces.push(
        <Line
          key={`v-trace-${i}`}
          x1={x}
          y1={dieY - 60}
          x2={x}
          y2={dieY + dieSize + 60}
          stroke={copper}
          strokeOpacity={traceOpacity}
          strokeWidth={i % 3 === 0 ? 2 : 1}
        />,
      );
    }

    return traces;
  };

  // Generate processor pads
  const generatePads = () => {
    const pads: React.ReactElement[] = [];
    const padSize = 8;
    const spacing = 20;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 3;
    const dieSize = 120;

    // Pads around the processor die
    const positions = [
      // Top pads
      ...Array.from({ length: 8 }, (_, i) => ({
        x: centerX - dieSize / 2 + (i * dieSize) / 7,
        y: centerY - dieSize / 2 - 30,
        size: padSize,
      })),
      // Bottom pads
      ...Array.from({ length: 8 }, (_, i) => ({
        x: centerX - dieSize / 2 + (i * dieSize) / 7,
        y: centerY + dieSize / 2 + 30,
        size: padSize,
      })),
      // Left pads
      ...Array.from({ length: 6 }, (_, i) => ({
        x: centerX - dieSize / 2 - 30,
        y: centerY - dieSize / 3 + (i * dieSize) / 5,
        size: padSize,
      })),
      // Right pads
      ...Array.from({ length: 6 }, (_, i) => ({
        x: centerX + dieSize / 2 + 30,
        y: centerY - dieSize / 3 + (i * dieSize) / 5,
        size: padSize,
      })),
    ];

    positions.forEach((pos, i) => {
      pads.push(
        <Rect
          key={`pad-${i}`}
          x={pos.x - pos.size / 2}
          y={pos.y - pos.size / 2}
          width={pos.size}
          height={pos.size}
          fill={gold}
          opacity={componentOpacity}
          rx={2}
        />,
      );

      // Add trace connections to pads
      const centerX = screenWidth / 2;
      const centerY = screenHeight / 3;
      const dieHalf = 60;

      if (pos.x < centerX - dieHalf) {
        // Left side connection
        pads.push(
          <Line
            key={`pad-trace-${i}`}
            x1={pos.x + pos.size / 2}
            y1={pos.y}
            x2={centerX - dieHalf}
            y2={pos.y}
            stroke={copper}
            strokeOpacity={traceOpacity * 0.7}
            strokeWidth={1}
          />,
        );
      } else if (pos.x > centerX + dieHalf) {
        // Right side connection
        pads.push(
          <Line
            key={`pad-trace-${i}`}
            x1={pos.x - pos.size / 2}
            y1={pos.y}
            x2={centerX + dieHalf}
            y2={pos.y}
            stroke={copper}
            strokeOpacity={traceOpacity * 0.7}
            strokeWidth={1}
          />,
        );
      } else if (pos.y < centerY - dieHalf) {
        // Top connection
        pads.push(
          <Line
            key={`pad-trace-${i}`}
            x1={pos.x}
            y1={pos.y + pos.size / 2}
            x2={pos.x}
            y2={centerY - dieHalf}
            stroke={copper}
            strokeOpacity={traceOpacity * 0.7}
            strokeWidth={1}
          />,
        );
      } else if (pos.y > centerY + dieHalf) {
        // Bottom connection
        pads.push(
          <Line
            key={`pad-trace-${i}`}
            x1={pos.x}
            y1={pos.y - pos.size / 2}
            x2={pos.x}
            y2={centerY + dieHalf}
            stroke={copper}
            strokeOpacity={traceOpacity * 0.7}
            strokeWidth={1}
          />,
        );
      }
    });

    return pads;
  };

  // Generate processor components (resistors, capacitors)
  const generateComponents = () => {
    const components: React.ReactElement[] = [];
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 3;

    // Small components scattered around
    const componentPositions = [
      { x: centerX - 100, y: centerY - 80, type: "resistor" },
      { x: centerX + 90, y: centerY - 70, type: "capacitor" },
      { x: centerX - 80, y: centerY + 90, type: "resistor" },
      { x: centerX + 110, y: centerY + 80, type: "capacitor" },
      { x: centerX - 120, y: centerY + 40, type: "resistor" },
      { x: centerX + 130, y: centerY - 40, type: "capacitor" },
    ];

    componentPositions.forEach((comp, i) => {
      if (comp.type === "resistor") {
        components.push(
          <Rect
            key={`resistor-${i}`}
            x={comp.x - 6}
            y={comp.y - 3}
            width={12}
            height={6}
            fill={silver}
            opacity={componentOpacity * 0.8}
            rx={1}
          />,
        );
      } else if (comp.type === "capacitor") {
        components.push(
          <G key={`capacitor-${i}`}>
            <Line
              x1={comp.x - 4}
              y1={comp.y - 6}
              x2={comp.x - 4}
              y2={comp.y + 6}
              stroke={silver}
              strokeOpacity={componentOpacity}
              strokeWidth={2}
            />
            <Line
              x1={comp.x + 4}
              y1={comp.y - 6}
              x2={comp.x + 4}
              y2={comp.y + 6}
              stroke={silver}
              strokeOpacity={componentOpacity}
              strokeWidth={2}
            />
          </G>,
        );
      }
    });

    return components;
  };

  // Central processor die
  const renderProcessorDie = () => {
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 3;
    const dieSize = 120;

    return (
      <G>
        {/* Main die */}
        <Rect
          x={centerX - dieSize / 2}
          y={centerY - dieSize / 2}
          width={dieSize}
          height={dieSize}
          fill={silicon}
          stroke={gold}
          strokeWidth={2}
          opacity={componentOpacity}
          rx={4}
        />

        {/* Die internal structure */}
        <Rect
          x={centerX - dieSize / 3}
          y={centerY - dieSize / 3}
          width={dieSize / 1.5}
          height={dieSize / 1.5}
          fill="none"
          stroke={copper}
          strokeWidth={1}
          opacity={componentOpacity * 0.6}
          rx={2}
        />

        {/* Processor core grid */}
        {Array.from({ length: 4 }, (_, i) => (
          <G key={`core-row-${i}`}>
            {Array.from({ length: 4 }, (_, j) => (
              <Rect
                key={`core-${i}-${j}`}
                x={centerX - dieSize / 4 + (i * dieSize) / 8}
                y={centerY - dieSize / 4 + (j * dieSize) / 8}
                width={dieSize / 12}
                height={dieSize / 12}
                fill={copper}
                opacity={componentOpacity * 0.8}
                rx={1}
              />
            ))}
          </G>
        ))}
      </G>
    );
  };

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: "none" }]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {/* Gradients */}
        <Defs>
          <LinearGradient
            id="processorGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <Stop offset="0%" stopColor="#0B0F19" stopOpacity="0.9" />
            <Stop offset="100%" stopColor="#1A1F2E" stopOpacity="0.7" />
          </LinearGradient>
          <LinearGradient
            id="prismGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <Stop offset="0%" stopColor="#FF006E" stopOpacity="0.8" />
            <Stop offset="50%" stopColor="#00F0FF" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#7B61FF" stopOpacity="0.8" />
          </LinearGradient>
        </Defs>

        {/* Background */}
        <Rect width="100%" height="100%" fill="url(#processorGradient)" />

        {/* Processor traces - updated with holographic glow */}
        {generateTraces()}

        {/* Holographic prism effect */}
        <Rect
          x={screenWidth * 0.1}
          y={screenHeight * 0.1}
          width={screenWidth * 0.8}
          height={4}
          fill="url(#prismGradient)"
          opacity={0.3}
          rx={2}
        />

        {/* Processor die with holographic glow */}
        {renderProcessorDie()}

        {/* Connection pads with glow */}
        {generatePads()}

        {/* Small components */}
        {generateComponents()}

        {/* Holographic glow overlay */}
        <Circle
          cx={screenWidth / 2}
          cy={screenHeight / 3}
          r={150}
          fill="#00D9FF"
          opacity={0.05}
        />

        {/* Additional decorative traces */}
        <Path
          d={`M 50 ${screenHeight * 0.2} Q ${screenWidth * 0.3} ${screenHeight * 0.1} ${screenWidth * 0.5} ${screenHeight * 0.3}`}
          fill="none"
          stroke={copper}
          strokeOpacity={traceOpacity * 0.5}
          strokeWidth={1.5}
        />
        <Path
          d={`M ${screenWidth - 50} ${screenHeight * 0.8} Q ${screenWidth * 0.7} ${screenHeight * 0.9} ${screenWidth * 0.5} ${screenHeight * 0.7}`}
          fill="none"
          stroke={copper}
          strokeOpacity={traceOpacity * 0.5}
          strokeWidth={1.5}
        />
      </Svg>
    </View>
  );
}
