/**
 * Worker pool for CPU-intensive map work: tile decoding, GeoJSON parsing, geometry simplification.
 * Use postMessage with transferables (ArrayBuffer) to avoid copying. Never decode tiles on main thread.
 */

let nextId = 1;

export interface WorkerTask<T = unknown> {
  id: number;
  data: unknown;
  transferables: Transferable[];
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private pending: Map<number, WorkerTask> = new Map();
  private taskQueue: WorkerTask[] = [];
  private workerScriptUrl: string | null = null;
  private workerScript: string | null = null;
  private maxWorkers: number;

  constructor(maxWorkers: number = 4) {
    this.maxWorkers = Math.max(1, maxWorkers);
  }

  /**
   * Set worker script by URL (for production) or inline string (for bundler).
   */
  setWorkerScript(urlOrScript: string, inline: boolean = false): void {
    if (inline) {
      this.workerScript = urlOrScript;
      this.workerScriptUrl = null;
    } else {
      this.workerScriptUrl = urlOrScript;
      this.workerScript = null;
    }
  }

  private createWorker(): Worker {
    if (this.workerScript) {
      const blob = new Blob([this.workerScript], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      return w;
    }
    if (this.workerScriptUrl) {
      return new Worker(this.workerScriptUrl);
    }
    throw new Error("WorkerPool: setWorkerScript() must be called before use");
  }

  private idleWorkerIndices: number[] = [];
  private workerTaskId: Map<number, number> = new Map();

  private assignNext(workerIndex: number): void {
    if (this.taskQueue.length === 0) {
      this.idleWorkerIndices.push(workerIndex);
      this.workerTaskId.delete(workerIndex);
      return;
    }
    const task = this.taskQueue.shift()!;
    this.pending.set(task.id, task);
    this.workerTaskId.set(workerIndex, task.id);
    const w = this.workers[workerIndex];
    w.postMessage(
      { id: task.id, data: task.data },
      task.transferables.length ? task.transferables : undefined
    );
  }

  private tryDispatch(): void {
    while (this.idleWorkerIndices.length > 0 && this.taskQueue.length > 0) {
      const idx = this.idleWorkerIndices.shift()!;
      this.assignNext(idx);
    }
  }

  private ensureWorkers(): void {
    while (this.workers.length < this.maxWorkers) {
      const idx = this.workers.length;
      const w = this.createWorker();
      w.onmessage = (e: MessageEvent) => {
        const { id, result, error } = e.data ?? {};
        const task = this.pending.get(id);
        if (task) {
          this.pending.delete(id);
          this.workerTaskId.delete(idx);
          if (error) task.reject(new Error(String(error)));
          else task.resolve(result as Parameters<typeof task.resolve>[0]);
          this.assignNext(idx);
        }
      };
      w.onerror = () => {
        const taskId = this.workerTaskId.get(idx);
        if (taskId !== undefined) {
          const task = this.pending.get(taskId);
          if (task) {
            this.pending.delete(taskId);
            task.reject(new Error("Worker error"));
          }
          this.workerTaskId.delete(idx);
        }
        this.assignNext(idx);
      };
      this.workers.push(w);
      this.idleWorkerIndices.push(idx);
    }
  }

  /**
   * Post data to next available worker. Transfer transferables to avoid copy.
   */
  postMessage<T = unknown>(data: unknown, transferables: Transferable[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const task: WorkerTask<T> = {
        id,
        data,
        transferables,
        resolve: resolve as (v: T) => void,
        reject,
      };
      this.taskQueue.push(task as WorkerTask);
      this.ensureWorkers();
      this.tryDispatch();
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const t of this.pending.values()) t.reject(new Error("WorkerPool terminated"));
    for (const t of this.taskQueue) t.reject(new Error("WorkerPool terminated"));
    this.pending.clear();
    this.taskQueue = [];
  }
}

/**
 * Default inline worker that echoes decode requests.
 * Replace with real tile decode (e.g. protobuf) in app or via setWorkerScript.
 */
export const TILE_DECODE_WORKER_SCRIPT = `
  self.onmessage = function(e) {
    var id = e.data.id;
    var data = e.data.data;
    try {
      if (data && data.arrayBuffer) {
        var ab = data.arrayBuffer;
        var decoded = { decoded: true, length: ab.byteLength };
        self.postMessage({ id: id, result: decoded }, []);
      } else {
        self.postMessage({ id: id, result: data }, []);
      }
    } catch (err) {
      self.postMessage({ id: id, error: String(err.message || err) }, []);
    }
  };
`;
