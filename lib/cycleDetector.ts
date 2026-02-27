/**
 * Tarjan-inspired cycle detector for graph traversal algorithms.
 * 
 * Detects infinite loops during Hierholzer's algorithm and other graph traversals
 * by tracking strongly connected component (SCC) membership and visit counts.
 * 
 * Key features:
 * - Identifies when traversal is stuck in a cycle
 * - Tracks SCC visit counts to detect repeated cycling
 * - Provides escape strategies via tabu lists
 * - Lightweight enough for real-time use during route construction
 */

export interface CycleDetectorConfig {
  /** Max times to revisit the same SCC before declaring a loop (default: 3) */
  maxSccRevisits: number;
  /** Max times to visit the same node in recent history (default: 5) */
  maxNodeRevisits: number;
  /** Size of the sliding window for recent node tracking (default: 50) */
  recentWindowSize: number;
  /** Enable detailed logging (default: false) */
  debug: boolean;
}

export const DEFAULT_CYCLE_CONFIG: CycleDetectorConfig = {
  maxSccRevisits: 3,
  maxNodeRevisits: 5,
  recentWindowSize: 50,
  debug: false,
};

export interface CycleDetectionResult {
  /** True if an infinite loop pattern was detected */
  isLooping: boolean;
  /** Type of loop detected */
  loopType: "none" | "scc-revisit" | "node-oscillation" | "zero-progress";
  /** The problematic node/SCC if detected */
  culprit?: string;
  /** Suggested nodes to avoid (tabu list) */
  tabuNodes: Set<string>;
  /** Number of iterations without progress */
  stagnantIterations: number;
}

/**
 * Cycle detector state maintained during graph traversal.
 * Create one instance per traversal and call methods as you visit nodes.
 */
export class CycleDetector {
  private config: CycleDetectorConfig;
  
  // Tarjan-style tracking
  private nodeIndex: Map<string, number> = new Map();
  private nodeLowlink: Map<string, number> = new Map();
  private onStack: Set<string> = new Set();
  /** Proper DFS stack for Tarjan SCC computation (separate from recentNodes history) */
  private dfsStack: string[] = [];
  private currentIndex: number = 0;

  // SCC tracking
  private sccId: Map<string, number> = new Map();
  private sccVisitCount: Map<number, number> = new Map();
  private currentSccId: number = 0;

  // Recent history for oscillation detection
  private recentNodes: string[] = [];
  private nodeVisitCount: Map<string, number> = new Map();
  
  // Progress tracking
  private lastEdgeCount: number = 0;
  private stagnantIterations: number = 0;
  
  // Tabu list for escape
  private tabuNodes: Set<string> = new Set();
  private tabuExpiry: Map<string, number> = new Map();
  private iterationCount: number = 0;

  constructor(config: Partial<CycleDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CYCLE_CONFIG, ...config };
  }

  /**
   * Public API to add a node to the tabu list manually (useful for
   * edge-based quotas or external heuristics).
   */
  public addTabu(nodeKey: string, extraWindowMultiplier: number = 1): void {
    this.addToTabu(nodeKey);
    // Extend expiry for externally-added tabu nodes slightly if requested
    const expiry = this.tabuExpiry.get(nodeKey);
    if (expiry !== undefined) {
      this.tabuExpiry.set(nodeKey, expiry + Math.floor(this.config.recentWindowSize * extraWindowMultiplier));
    }
  }

  /**
   * Call when entering a node during traversal.
   * Returns detection result indicating if we're stuck in a loop.
   */
  enterNode(nodeKey: string, remainingEdges: number): CycleDetectionResult {
    this.iterationCount++;
    this.expireTabu();
    
    // Track recent history
    this.recentNodes.push(nodeKey);
    if (this.recentNodes.length > this.config.recentWindowSize) {
      const removed = this.recentNodes.shift()!;
      const count = this.nodeVisitCount.get(removed) ?? 0;
      if (count > 1) {
        this.nodeVisitCount.set(removed, count - 1);
      } else {
        this.nodeVisitCount.delete(removed);
      }
    }
    this.nodeVisitCount.set(nodeKey, (this.nodeVisitCount.get(nodeKey) ?? 0) + 1);
    
    // Check for node oscillation (same node visited too many times recently)
    const nodeVisits = this.nodeVisitCount.get(nodeKey) ?? 0;
    if (nodeVisits > this.config.maxNodeRevisits) {
      if (this.config.debug) {
        console.warn(`[CycleDetector] Node oscillation: ${nodeKey} visited ${nodeVisits} times`);
      }
      this.addToTabu(nodeKey);
      return {
        isLooping: true,
        loopType: "node-oscillation",
        culprit: nodeKey,
        tabuNodes: new Set(this.tabuNodes),
        stagnantIterations: this.stagnantIterations,
      };
    }
    
    // Tarjan-style SCC detection on first visit
    if (!this.nodeIndex.has(nodeKey)) {
      this.nodeIndex.set(nodeKey, this.currentIndex);
      this.nodeLowlink.set(nodeKey, this.currentIndex);
      this.currentIndex++;
      this.onStack.add(nodeKey);
      this.dfsStack.push(nodeKey);
    } else if (this.onStack.has(nodeKey)) {
      // Back edge detected - we're in a cycle
      const scc = this.sccId.get(nodeKey);
      if (scc !== undefined) {
        const visits = (this.sccVisitCount.get(scc) ?? 0) + 1;
        this.sccVisitCount.set(scc, visits);
        
        if (visits > this.config.maxSccRevisits) {
          if (this.config.debug) {
            console.warn(`[CycleDetector] SCC ${scc} revisited ${visits} times`);
          }
          this.addToTabu(nodeKey);
          return {
            isLooping: true,
            loopType: "scc-revisit",
            culprit: nodeKey,
            tabuNodes: new Set(this.tabuNodes),
            stagnantIterations: this.stagnantIterations,
          };
        }
      }
    }
    
    // Check for zero progress (edge count not decreasing)
    // Note: In Hierholzer, we always remove an edge when moving forward,
    // so stagnation means we're backtracking without consuming edges
    if (remainingEdges >= this.lastEdgeCount && this.lastEdgeCount > 0) {
      this.stagnantIterations++;
      // Trigger at 25 iterations (half window) for earlier detection
      if (this.stagnantIterations > Math.floor(this.config.recentWindowSize / 2)) {
        if (this.config.debug) {
          console.warn(`[CycleDetector] Zero progress for ${this.stagnantIterations} iterations`);
        }
        this.addToTabu(nodeKey);
        return {
          isLooping: true,
          loopType: "zero-progress",
          culprit: nodeKey,
          tabuNodes: new Set(this.tabuNodes),
          stagnantIterations: this.stagnantIterations,
        };
      }
    } else if (remainingEdges < this.lastEdgeCount) {
      // Made progress - reset stagnation counter
      this.stagnantIterations = 0;
    }
    // Don't reset on equal - could be oscillating at same edge count
    this.lastEdgeCount = remainingEdges;
    
    return {
      isLooping: false,
      loopType: "none",
      tabuNodes: new Set(this.tabuNodes),
      stagnantIterations: this.stagnantIterations,
    };
  }

  /**
   * Call when leaving a node (backtracking in Hierholzer).
   * Updates SCC membership based on Tarjan's algorithm.
   */
  leaveNode(nodeKey: string): void {
    if (!this.onStack.has(nodeKey)) return;

    const index = this.nodeIndex.get(nodeKey);
    const lowlink = this.nodeLowlink.get(nodeKey);

    // If this is an SCC root (lowlink == index), pop all nodes from the
    // DFS stack down to (and including) nodeKey and assign them a single SCC id.
    if (index !== undefined && lowlink !== undefined && lowlink === index) {
      const sccNodes: string[] = [];
      let w: string | undefined;
      do {
        w = this.dfsStack.pop();
        if (w !== undefined) {
          this.onStack.delete(w);
          this.sccId.set(w, this.currentSccId);
          sccNodes.push(w);
        }
      } while (w !== undefined && w !== nodeKey);

      if (this.config.debug && sccNodes.length > 1) {
        console.log(`[CycleDetector] Found SCC ${this.currentSccId} with ${sccNodes.length} nodes`);
      }
      this.currentSccId++;
    }
  }

  /**
   * Update lowlink when traversing an edge to a neighbor.
   */
  updateLowlink(fromKey: string, toKey: string): void {
    const fromLowlink = this.nodeLowlink.get(fromKey);
    const toLowlink = this.nodeLowlink.get(toKey);
    const toIndex = this.nodeIndex.get(toKey);
    
    if (fromLowlink === undefined) return;
    
    if (this.onStack.has(toKey) && toIndex !== undefined) {
      // Back edge to node on stack
      this.nodeLowlink.set(fromKey, Math.min(fromLowlink, toIndex));
    } else if (toLowlink !== undefined) {
      // Tree edge
      this.nodeLowlink.set(fromKey, Math.min(fromLowlink, toLowlink));
    }
  }

  /**
   * Check if a node should be avoided (in tabu list).
   */
  isTabu(nodeKey: string): boolean {
    return this.tabuNodes.has(nodeKey);
  }

  /**
   * Get penalty multiplier for a node based on visit history.
   * Higher values indicate nodes that should be avoided.
   */
  getPenalty(nodeKey: string): number {
    const visits = this.nodeVisitCount.get(nodeKey) ?? 0;
    if (this.tabuNodes.has(nodeKey)) return 2000; // Increased from 1000
    if (visits === 0) return 0;
    // Exponential penalty based on recent visits, capped to avoid overflow
    const expPenalty = Math.min(Math.pow(2, visits), 256) * 15;
    return expPenalty;
  }

  /**
   * Force-clear tabu for a node (use when no other options exist).
   */
  clearTabu(nodeKey: string): void {
    this.tabuNodes.delete(nodeKey);
    this.tabuExpiry.delete(nodeKey);
  }

  /**
   * Reset detector state (use when starting a new traversal).
   */
  reset(): void {
    this.nodeIndex.clear();
    this.nodeLowlink.clear();
    this.onStack.clear();
    this.dfsStack = [];
    this.currentIndex = 0;
    this.sccId.clear();
    this.sccVisitCount.clear();
    this.currentSccId = 0;
    this.recentNodes = [];
    this.nodeVisitCount.clear();
    this.lastEdgeCount = 0;
    this.stagnantIterations = 0;
    this.tabuNodes.clear();
    this.tabuExpiry.clear();
    this.iterationCount = 0;
  }

  /**
   * Get diagnostic info about current state.
   */
  getDiagnostics(): {
    totalNodesVisited: number;
    uniqueNodes: number;
    sccsFound: number;
    tabuListSize: number;
    stagnantIterations: number;
    mostVisitedNodes: Array<{ node: string; visits: number }>;
  } {
    const mostVisited: Array<{ node: string; visits: number }> = [];
    this.nodeVisitCount.forEach((visits, node) => {
      mostVisited.push({ node, visits });
    });
    mostVisited.sort((a, b) => b.visits - a.visits);
    
    return {
      totalNodesVisited: this.iterationCount,
      uniqueNodes: this.nodeIndex.size,
      sccsFound: this.currentSccId,
      tabuListSize: this.tabuNodes.size,
      stagnantIterations: this.stagnantIterations,
      mostVisitedNodes: mostVisited.slice(0, 10),
    };
  }

  // Private helpers

  private addToTabu(nodeKey: string): void {
    this.tabuNodes.add(nodeKey);
    // Tabu expires after 2x window size iterations
    this.tabuExpiry.set(nodeKey, this.iterationCount + this.config.recentWindowSize * 2);
  }

  private expireTabu(): void {
    const toRemove: string[] = [];
    this.tabuExpiry.forEach((expiry, node) => {
      if (this.iterationCount >= expiry) {
        toRemove.push(node);
      }
    });
    for (const node of toRemove) {
      this.tabuNodes.delete(node);
      this.tabuExpiry.delete(node);
    }
  }

}

/**
 * Lightweight cycle check for simple oscillation detection.
 * Use when full Tarjan tracking is overkill.
 */
export function detectSimpleOscillation(
  recentPath: string[],
  windowSize: number = 12,
  maxRepeats: number = 3
): { isOscillating: boolean; culprit?: string } {
  if (recentPath.length < windowSize) {
    return { isOscillating: false };
  }
  
  const window = recentPath.slice(-windowSize);
  const counts = new Map<string, number>();
  
  for (const node of window) {
    const count = (counts.get(node) ?? 0) + 1;
    counts.set(node, count);
    if (count > maxRepeats) {
      return { isOscillating: true, culprit: node };
    }
  }
  
  return { isOscillating: false };
}

/**
 * Floyd's cycle detection for route sequences.
 * Detects if a route has entered a repeating pattern.
 */
export function detectRouteCycle(
  route: string[],
  minCycleLength: number = 3,
  maxCycleLength: number = 20
): { hasCycle: boolean; cycleStart?: number; cycleLength?: number } {
  if (route.length < minCycleLength * 2) {
    return { hasCycle: false };
  }
  
  // Check for repeating patterns of various lengths
  for (let len = minCycleLength; len <= Math.min(maxCycleLength, Math.floor(route.length / 2)); len++) {
    const end = route.length;
    const start = end - len;
    const prevStart = start - len;
    
    if (prevStart < 0) continue;
    
    let matches = true;
    for (let i = 0; i < len; i++) {
      if (route[start + i] !== route[prevStart + i]) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      return { hasCycle: true, cycleStart: prevStart, cycleLength: len };
    }
  }
  
  return { hasCycle: false };
}
