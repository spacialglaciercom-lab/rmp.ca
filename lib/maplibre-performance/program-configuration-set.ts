/**
 * Program configuration batching for map layers.
 * Generates merge keys from layer type and paint/layout so layers sharing
 * the same shader config can be grouped to minimize gl.useProgram() switches.
 * Use when driving custom WebGL rendering or with a forked MapLibre that
 * accepts external batch order.
 */

export type LayerType =
  | "fill"
  | "line"
  | "symbol"
  | "circle"
  | "heatmap"
  | "raster"
  | "background";

export interface LayerSpecLike {
  type?: string;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

export interface ProgramConfiguration {
  id: string;
  mergeKey: string;
  layerType: LayerType;
}

const layerTypes: LayerType[] = [
  "fill",
  "line",
  "symbol",
  "circle",
  "heatmap",
  "raster",
  "background",
];

function isLayerType(t: string): t is LayerType {
  return layerTypes.includes(t as LayerType);
}

/**
 * Generate a stable merge key from layer spec for batching.
 */
export function getProgramMergeKey(layer: LayerSpecLike): string {
  const type = (layer.type ?? "fill") as string;
  const paint = layer.paint ?? {};
  const layout = layer.layout ?? {};
  const paintKeys = Object.keys(paint)
    .sort()
    .filter((k) => paint[k] != null);
  const layoutKeys = Object.keys(layout)
    .sort()
    .filter((k) => layout[k] != null);
  const paintPart = paintKeys
    .map((k) => `${k}:${String((paint as Record<string, unknown>)[k])}`)
    .join("|");
  const layoutPart = layoutKeys
    .map((k) => `${k}:${String((layout as Record<string, unknown>)[k])}`)
    .join("|");
  return `${type};${paintPart};${layoutPart}`;
}

export class ProgramConfigurationSet {
  private configurations: Map<string, ProgramConfiguration> = new Map();
  private mergeKeyToId: Map<string, string> = new Map();

  addConfiguration(layer: LayerSpecLike, id?: string): ProgramConfiguration {
    const mergeKey = getProgramMergeKey(layer);
    const existingId = this.mergeKeyToId.get(mergeKey);
    if (existingId) {
      return this.configurations.get(existingId)!;
    }
    const layerType = isLayerType((layer.type ?? "fill") as string)
      ? (layer.type as LayerType)
      : "fill";
    const configId = id ?? `prog_${this.configurations.size}`;
    const config: ProgramConfiguration = { id: configId, mergeKey, layerType };
    this.configurations.set(configId, config);
    this.mergeKeyToId.set(mergeKey, configId);
    return config;
  }

  getConfiguration(id: string): ProgramConfiguration | undefined {
    return this.configurations.get(id);
  }

  /**
   * Sort layers so that those sharing the same program configuration are adjacent.
   */
  getBatchRenderOrder<T extends { id: string }>(
    layers: T[],
    getMergeKey: (layer: T) => string,
  ): T[] {
    const keyToLayers = new Map<string, T[]>();
    for (const layer of layers) {
      const key = getMergeKey(layer);
      let list = keyToLayers.get(key);
      if (!list) {
        list = [];
        keyToLayers.set(key, list);
      }
      list.push(layer);
    }
    const result: T[] = [];
    for (const list of keyToLayers.values()) {
      result.push(...list);
    }
    return result;
  }

  clear(): void {
    this.configurations.clear();
    this.mergeKeyToId.clear();
  }
}
