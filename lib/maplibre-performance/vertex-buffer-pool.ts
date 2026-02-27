/**
 * WebGL Vertex Buffer Object (VBO) pool to reduce allocation and GC pressure.
 * Use with a WebGL2 (or WebGL1) context when managing buffers for map geometry.
 * Pools are categorized by size ranges for reuse without wasting memory.
 */

const SIZE_SMALL = 1024;       // < 1KB
const SIZE_MEDIUM = 10 * 1024; // 1–10KB
const MAX_POOL_SMALL = 32;
const MAX_POOL_MEDIUM = 16;
const MAX_POOL_LARGE = 8;

type GL = WebGL2RenderingContext | WebGLRenderingContext;

function getPoolKey(size: number): "small" | "medium" | "large" {
  if (size <= SIZE_SMALL) return "small";
  if (size <= SIZE_MEDIUM) return "medium";
  return "large";
}

function getMaxPoolSize(key: "small" | "medium" | "large"): number {
  switch (key) {
    case "small": return MAX_POOL_SMALL;
    case "medium": return MAX_POOL_MEDIUM;
    case "large": return MAX_POOL_LARGE;
  }
}

export class VertexBufferPool {
  private pool: Map<"small" | "medium" | "large", WebGLBuffer[]> = new Map([
    ["small", []],
    ["medium", []],
    ["large", []],
  ]);
  private activeBuffers: Set<WebGLBuffer> = new Set();
  private gl: GL | null = null;

  bindContext(gl: GL): void {
    this.gl = gl;
  }

  /**
   * Acquire a buffer of at least the given size (bytes). Reuses from pool if available.
   */
  acquireBuffer(gl: GL, size: number): WebGLBuffer {
    this.gl = gl;
    const key = getPoolKey(size);
    const list = this.pool.get(key)!;
    const maxPool = getMaxPoolSize(key);
    if (list.length > 0) {
      const buf = list.pop()!;
      this.activeBuffers.add(buf);
      return buf;
    }
    const buf = gl.createBuffer()!;
    this.activeBuffers.add(buf);
    return buf;
  }

  /**
   * Release a buffer back to the pool. Buffer should be unbound before calling.
   */
  releaseBuffer(gl: GL, buffer: WebGLBuffer, size: number): void {
    this.activeBuffers.delete(buffer);
    const key = getPoolKey(size);
    const list = this.pool.get(key)!;
    if (list.length < getMaxPoolSize(key)) {
      list.push(buffer);
    } else {
      gl.deleteBuffer(buffer);
    }
  }

  /**
   * Release all pooled buffers (e.g. on context loss or teardown).
   */
  releaseAll(gl: GL): void {
    for (const list of this.pool.values()) {
      while (list.length > 0) {
        const buf = list.pop()!;
        gl.deleteBuffer(buf);
      }
    }
    this.activeBuffers.clear();
  }

  getPoolStats(): { small: number; medium: number; large: number; active: number } {
    return {
      small: this.pool.get("small")!.length,
      medium: this.pool.get("medium")!.length,
      large: this.pool.get("large")!.length,
      active: this.activeBuffers.size,
    };
  }
}
