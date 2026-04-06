import type { TrackType } from "../types/manifest";
import { assertNotVoid } from "../utils/assert";

type Operation = {
  execute: () => void;
  onComplete: () => void;
};

export class OperationQueue {
  private queues_ = new Map<TrackType, Operation[]>();
  private sourceBuffers_ = new Map<TrackType, SourceBuffer>();

  /**
   * Register a SourceBuffer for a track type.
   * Stores the reference for updating-state checks.
   */
  add(type: TrackType, sourceBuffer: SourceBuffer) {
    this.queues_.set(type, []);
    this.sourceBuffers_.set(type, sourceBuffer);
  }

  /**
   * Push an operation onto the queue. Executes
   * immediately if the queue was empty.
   */
  enqueue(type: TrackType, operation: Operation) {
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
   * Append a blocker to the queue. Returns a
   * promise that resolves when all prior operations
   * complete and the blocker reaches the front.
   * TODO: Add prepend support for codec switching.
   */
  block(type: TrackType): Promise<void> {
    return new Promise((resolve) => {
      const operation: Operation = {
        execute: () => {
          resolve();
          const queue = this.queues_.get(type);
          assertNotVoid(queue, "Queue missing for blocker");
          queue.shift();
          this.executeNext_(type);
        },
        onComplete: () => {},
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
   * Complete the current operation and execute
   * the next one. Called by the controller when
   * the SourceBuffer fires updateend.
   */
  shiftAndExecuteNext(type: TrackType) {
    const queue = this.queues_.get(type);
    if (!queue || queue.length === 0) {
      return;
    }
    const operation = queue.shift();
    assertNotVoid(operation, "Queue not empty but no operation");
    operation.onComplete();
    this.executeNext_(type);
  }

  /** Clear all queues and references. */
  destroy() {
    this.queues_.clear();
    this.sourceBuffers_.clear();
  }

  private executeNext_(type: TrackType) {
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
