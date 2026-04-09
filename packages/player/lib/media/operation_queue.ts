import type { MediaType } from "../types/media";
import { assertNotVoid } from "../utils/assert";

type Operation = {
  execute: () => void;
  onComplete?: () => void;
};

export class OperationQueue {
  private queues_ = new Map<MediaType, Operation[]>();
  private sourceBuffers_ = new Map<MediaType, SourceBuffer>();

  /**
   * Register a SourceBuffer for updating-state checks.
   */
  add(type: MediaType, sourceBuffer: SourceBuffer) {
    this.queues_.set(type, []);
    this.sourceBuffers_.set(type, sourceBuffer);
  }

  /**
   * Push an operation onto the queue. Executes immediately
   * if the queue was empty.
   */
  enqueue(type: MediaType, operation: Operation) {
    const queue = this.queues_.get(type);
    if (!queue) {
      return;
    }
    queue.push(operation);
    if (queue.length === 1) {
      this.executeNext_(type);
    }
  }

  /**
   * Append a blocker that resolves when all prior
   * operations complete.
   * TODO: Add prepend support for codec switching.
   */
  block(type: MediaType): Promise<void> {
    return new Promise((resolve) => {
      const operation: Operation = {
        execute: () => {
          resolve();
          const queue = this.queues_.get(type);
          assertNotVoid(queue, "Queue missing for blocker");
          queue.shift();
          this.executeNext_(type);
        },
      };
      const queue = this.queues_.get(type);
      if (!queue) {
        resolve();
        return;
      }
      queue.push(operation);
      if (queue.length === 1) {
        this.executeNext_(type);
      }
    });
  }

  /**
   * Complete the current operation and execute the next.
   * Called on SourceBuffer updateend.
   */
  shiftAndExecuteNext(type: MediaType) {
    const queue = this.queues_.get(type);
    if (!queue || queue.length === 0) {
      return;
    }
    const operation = queue.shift();
    assertNotVoid(operation, "Queue not empty but no operation");
    operation.onComplete?.();
    this.executeNext_(type);
  }

  destroy() {
    this.queues_.clear();
    this.sourceBuffers_.clear();
  }

  private executeNext_(type: MediaType) {
    const queue = this.queues_.get(type);
    if (!queue || queue.length === 0) {
      return;
    }
    const operation = queue[0];
    assertNotVoid(operation, "Queue not empty but no operation");
    try {
      operation.execute();
    } catch {
      const sb = this.sourceBuffers_.get(type);
      if (!sb?.updating) {
        queue.shift();
        this.executeNext_(type);
      }
    }
  }
}
