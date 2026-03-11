/**
 * InstructionManager — Import delivery instructions from JSON and match to route stops by address.
 * JSON File → Import → InstructionManager → Route Calculation → Auto-Matched Instructions
 */

export type InstructionPriority = "critical" | "high" | "medium" | "low";

export interface DeliveryInstruction {
  address: string;
  title: string;
  details: string;
  id?: string;
  priority?: InstructionPriority;
}

export interface DeliveryInstructionsJson {
  instructions: DeliveryInstruction[];
}

/** Normalize address for fuzzy matching: lowercase, collapse spaces, remove punctuation. */
function normalizeAddress(addr: string): string {
  return addr.toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ").trim();
}

/** Check if route address/label contains instruction address or vice versa (substring match). */
function addressesMatch(routeAddr: string, instructionAddr: string): boolean {
  const a = normalizeAddress(routeAddr);
  const b = normalizeAddress(instructionAddr);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

class InstructionManagerImpl {
  private instructions: DeliveryInstruction[] = [];
  private byAddress: Map<string, DeliveryInstruction> = new Map();

  /** Import instructions from JSON. Call once at startup. */
  importFromJson(data: DeliveryInstructionsJson): void {
    const list = Array.isArray(data?.instructions) ? data.instructions : [];
    this.instructions = list;
    this.byAddress.clear();
    for (const inst of list) {
      const key = normalizeAddress(inst.address);
      if (key && !this.byAddress.has(key)) {
        this.byAddress.set(key, inst);
      }
    }
  }

  /** Get all instructions. */
  getAll(): DeliveryInstruction[] {
    return [...this.instructions];
  }

  /** Get instruction by exact normalized address. */
  getByAddress(address: string): DeliveryInstruction | undefined {
    return this.byAddress.get(normalizeAddress(address));
  }

  /** Find instruction matching route stop address/label (fuzzy). */
  matchForRouteStop(addressOrLabel: string): DeliveryInstruction | undefined {
    const normalized = normalizeAddress(addressOrLabel);
    if (!normalized) return undefined;

    for (const inst of this.instructions) {
      if (addressesMatch(addressOrLabel, inst.address)) {
        return inst;
      }
    }
    return undefined;
  }

  /** Count of loaded instructions. */
  get count(): number {
    return this.instructions.length;
  }
}

const instructionManager = new InstructionManagerImpl();
export default instructionManager;

/** Minimal instruction slice attached to a route stop. */
export interface RouteStopInstruction {
  title: string;
  details: string;
  priority?: InstructionPriority;
}

/** Route stop shape accepted by enrichRoute. Uses address or label for matching. */
export interface RouteStopInput {
  address?: string;
  label?: string;
  lat: number;
  lon: number;
  [key: string]: unknown;
}

/** Enriched route stop with auto-matched instructions. */
export interface EnrichedRouteStop extends RouteStopInput {
  instructions: RouteStopInstruction[];
}

/**
 * Enrich route stops with auto-matched delivery instructions.
 * When you calculate a route, pass stops through this — instructions auto-attach by address.
 */
export function enrichRoute<T extends RouteStopInput>(
  routeStops: T[],
): (T & { instructions: RouteStopInstruction[] })[] {
  return routeStops.map((stop) => {
    const addr = stop.address ?? stop.label ?? "";
    const matched = instructionManager.matchForRouteStop(addr);
    const instructions: RouteStopInstruction[] = matched
      ? [
          {
            title: matched.title,
            details: matched.details,
            ...(matched.priority && { priority: matched.priority }),
          },
        ]
      : [];
    return { ...stop, instructions };
  });
}

/** Alias for enrichRoute — instructions auto-attach by address match. */
export const buildRoute = enrichRoute;
