/**
 * Performance optimization utilities for TrashRoute
 */

/**
 * Measure execution time of a function
 */
export function measurePerformance<T>(
  name: string,
  fn: () => T
): T {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  const duration = end - start;

  if (duration > 100) {
    console.warn(`⚠️ ${name} took ${duration.toFixed(2)}ms (slow)`);
  } else {
    console.log(`✓ ${name} took ${duration.toFixed(2)}ms`);
  }

  return result;
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: any = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle function calls
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Memoize function results
 */
export function memoize<T extends (...args: any[]) => any>(fn: T): T {
  const cache = new Map();

  return ((...args: Parameters<T>) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

/**
 * Batch state updates to reduce re-renders
 */
export function batchUpdates(updates: Array<() => void>): void {
  updates.forEach((update) => update());
}

/**
 * Memory usage monitoring
 */
export function logMemoryUsage(label: string = ""): void {
  if (typeof performance !== "undefined" && (performance as any).memory) {
    const memory = (performance as any).memory;
    const used = (memory.usedJSHeapSize / 1048576).toFixed(2);
    const limit = (memory.jsHeapSizeLimit / 1048576).toFixed(2);
    console.log(`📊 Memory ${label}: ${used}MB / ${limit}MB`);
  }
}

/**
 * Check if object has changed
 */
export function hasChanged<T>(prev: T, curr: T): boolean {
  return JSON.stringify(prev) !== JSON.stringify(curr);
}

/**
 * Optimize array operations
 */
export const arrayOps = {
  /**
   * Chunk array into smaller arrays
   */
  chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  },

  /**
   * Remove duplicates from array
   */
  unique<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
  },

  /**
   * Flatten nested array
   */
  flatten<T>(arr: any[]): T[] {
    return arr.reduce((acc: T[], val: any) => {
      if (Array.isArray(val)) {
        return acc.concat(val);
      }
      return acc.concat([val]);
    }, []);
  },

  /**
   * Partition array based on predicate
   */
  partition<T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]] {
    return [arr.filter(predicate), arr.filter((x) => !predicate(x))];
  },
};

/**
 * Optimize object operations
 */
export const objectOps = {
  /**
   * Deep clone object
   */
  deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  },

  /**
   * Merge objects
   */
  merge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    return { ...target, ...source };
  },

  /**
   * Pick specific keys from object
   */
  pick<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Pick<T, K> {
    return keys.reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {} as Pick<T, K>);
  },

  /**
   * Omit specific keys from object
   */
  omit<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Omit<T, K> {
    const keySet = new Set(keys);
    const result: any = {};
    Object.keys(obj).forEach((key) => {
      if (!keySet.has(key as K)) {
        result[key] = obj[key];
      }
    });
    return result;
  },
};
