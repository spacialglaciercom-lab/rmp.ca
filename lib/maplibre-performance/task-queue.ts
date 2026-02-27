/**
 * Priority task queue for map and UI work.
 * Ensures critical work (render, input) runs first; non-critical work is frame-budgeted.
 */

export enum TaskPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export type TaskID = number;

interface QueuedTask {
  id: TaskID;
  callback: () => void;
  priority: TaskPriority;
}

let nextTaskId = 1;

export class PriorityTaskQueue {
  private queues: Map<TaskPriority, QueuedTask[]> = new Map([
    [TaskPriority.CRITICAL, []],
    [TaskPriority.HIGH, []],
    [TaskPriority.NORMAL, []],
    [TaskPriority.LOW, []],
  ]);

  schedule(callback: () => void, priority: TaskPriority = TaskPriority.NORMAL): TaskID {
    const id = nextTaskId++;
    const task: QueuedTask = { id, callback, priority };
    const q = this.queues.get(priority)!;
    q.push(task);
    return id;
  }

  cancel(id: TaskID): boolean {
    for (const q of this.queues.values()) {
      const i = q.findIndex((t) => t.id === id);
      if (i >= 0) {
        q.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Process tasks until timeLimit (ms) is reached.
   * Processes in priority order: CRITICAL, then HIGH, then NORMAL, then LOW.
   * @returns true if more work remains
   */
  process(timeLimitMs: number = 8): boolean {
    const deadline = performance.now() + timeLimitMs;
    const order: TaskPriority[] = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.NORMAL,
      TaskPriority.LOW,
    ];
    for (const p of order) {
      const q = this.queues.get(p)!;
      while (q.length > 0 && performance.now() < deadline) {
        const task = q.shift()!;
        try {
          task.callback();
        } catch (e) {
          console.warn("[PriorityTaskQueue] task threw:", e);
        }
      }
    }
    return this.hasRemaining();
  }

  hasRemaining(): boolean {
    return Array.from(this.queues.values()).some((q) => q.length > 0);
  }

  flush(): void {
    const order: TaskPriority[] = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.NORMAL,
      TaskPriority.LOW,
    ];
    for (const p of order) {
      const q = this.queues.get(p)!;
      while (q.length > 0) {
        const task = q.shift()!;
        try {
          task.callback();
        } catch (e) {
          console.warn("[PriorityTaskQueue] task threw:", e);
        }
      }
    }
  }
}
