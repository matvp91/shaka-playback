import type { SourceBufferMediaType } from "../types/media";
import { MediaType } from "../types/media";

export interface OperationQueueDelegate {
  /** Whether the SourceBuffer for this type is currently updating. */
  isUpdating: (type: SourceBufferMediaType) => boolean;
}

export const OperationKind = {
  Append: "append",
  Block: "block",
  ChangeType: "changeType",
  Flush: "flush",
  QuotaCleanup: "quotaCleanup",
} as const;

export type Operation = {
  kind: string;
  execute: () => void;
  onComplete?: () => void;
  onError?: (error: unknown) => void;
};

export class OperationQueue {
  private queues_: Record<SourceBufferMediaType, Operation[]> = {
    [MediaType.VIDEO]: [],
    [MediaType.AUDIO]: [],
  };

  constructor(private delegate_: OperationQueueDelegate) {}

  /**
   * Push an operation onto the queue. Executes immediately
   * if the queue was empty.
   */
  enqueue(type: SourceBufferMediaType, operation: Operation) {
    const queue = this.queues_[type];
    queue.push(operation);
    if (queue.length === 1) {
      this.executeNext_(type);
    }
  }

  /**
   * Append a blocker that resolves when all prior operations
   * complete. The caller must call shiftAndExecuteNext to
   * advance past the blocker.
   */
  block(type: SourceBufferMediaType): Promise<void> {
    return new Promise((resolve) => {
      this.enqueue(type, {
        kind: OperationKind.Block,
        execute: resolve,
      });
    });
  }

  /**
   * Insert operations after the currently-executing operation.
   * If the queue is empty, executes the first inserted
   * operation immediately.
   */
  insertNext(type: SourceBufferMediaType, operations: Operation[]) {
    const queue = this.queues_[type];
    queue.splice(1, 0, ...operations);
    if (queue.length === operations.length) {
      this.executeNext_(type);
    }
  }

  /**
   * Complete the current operation and execute the next.
   * Called on SourceBuffer updateend or by the caller after
   * a blocker resolves.
   */
  shiftAndExecuteNext(type: SourceBufferMediaType) {
    const queue = this.queues_[type];
    if (queue.length === 0) {
      return;
    }
    const operation = queue.shift();
    if (operation) {
      operation.onComplete?.();
    }
    this.executeNext_(type);
  }

  /** Debug string showing queue state per type. */
  toString(): string {
    return [
      this.formatQueue_(MediaType.VIDEO),
      this.formatQueue_(MediaType.AUDIO),
    ]
      .filter(Boolean)
      .join("\n");
  }

  private executeNext_(type: SourceBufferMediaType) {
    const queue = this.queues_[type];
    if (queue.length === 0) {
      return;
    }
    const operation = queue[0];
    if (!operation) {
      return;
    }
    try {
      operation.execute();
      if (
        !this.delegate_.isUpdating(type) &&
        operation.kind !== OperationKind.Block
      ) {
        this.shiftAndExecuteNext(type);
      }
    } catch (error) {
      operation.onError?.(error);
      if (!this.delegate_.isUpdating(type)) {
        this.shiftAndExecuteNext(type);
      }
    }
  }

  private formatQueue_(type: SourceBufferMediaType): string {
    const queue = this.queues_[type];
    if (queue.length === 0) {
      return "";
    }
    return `${type}: ${queue.map((op) => op.kind).join(", ")}`;
  }
}
