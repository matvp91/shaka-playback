import { describe, expect, it, vi } from "vitest";
import type { OperationQueueDelegate } from "../../lib/media/operation_queue";
import { OperationKind, OperationQueue } from "../../lib/media/operation_queue";
import { MediaType } from "../../lib/types/media";

function createDelegate(updating = false): OperationQueueDelegate {
  return { isUpdating: () => updating };
}

function op(overrides: Record<string, unknown> = {}) {
  return {
    kind: OperationKind.Append,
    execute: vi.fn(),
    ...overrides,
  };
}

describe("OperationQueue", () => {
  it("executes the first enqueued operation immediately", () => {
    const queue = new OperationQueue(createDelegate());
    const operation = op();

    queue.enqueue(MediaType.VIDEO, operation);

    expect(operation.execute).toHaveBeenCalledOnce();
  });

  it("defers subsequent operations until the current one completes", () => {
    const queue = new OperationQueue(createDelegate(true));
    const first = op();
    const second = op();

    queue.enqueue(MediaType.VIDEO, first);
    queue.enqueue(MediaType.VIDEO, second);

    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).not.toHaveBeenCalled();
  });

  it("calls onComplete and advances on shiftAndExecuteNext", () => {
    const queue = new OperationQueue(createDelegate(true));
    const onComplete = vi.fn();
    const first = op({ onComplete });
    const second = op();

    queue.enqueue(MediaType.VIDEO, first);
    queue.enqueue(MediaType.VIDEO, second);
    queue.shiftAndExecuteNext(MediaType.VIDEO);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(second.execute).toHaveBeenCalledOnce();
  });

  it("inserts operations after the currently-executing operation", () => {
    const queue = new OperationQueue(createDelegate(true));
    const order: number[] = [];

    queue.enqueue(MediaType.VIDEO, op({ execute: () => order.push(1) }));
    queue.enqueue(MediaType.VIDEO, op({ execute: () => order.push(3) }));
    queue.insertNext(MediaType.VIDEO, [op({ execute: () => order.push(2) })]);

    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);

    expect(order).toEqual([1, 2, 3]);
  });

  it("resolves block promise when it reaches the front of the queue", async () => {
    const queue = new OperationQueue(createDelegate());
    const resolved = vi.fn();

    queue.block(MediaType.VIDEO).then(resolved);
    await Promise.resolve();

    expect(resolved).toHaveBeenCalledOnce();
  });

  it("does not auto-advance past a blocker", async () => {
    const queue = new OperationQueue(createDelegate());
    const second = op();

    queue.block(MediaType.VIDEO);
    queue.enqueue(MediaType.VIDEO, second);
    await Promise.resolve();

    expect(second.execute).not.toHaveBeenCalled();
  });

  it("advances past a blocker when caller calls shiftAndExecuteNext", async () => {
    const queue = new OperationQueue(createDelegate());
    const second = op();

    queue.block(MediaType.VIDEO);
    queue.enqueue(MediaType.VIDEO, second);
    await Promise.resolve();

    queue.shiftAndExecuteNext(MediaType.VIDEO);

    expect(second.execute).toHaveBeenCalledOnce();
  });

  it("calls onError with the thrown error when execute fails", () => {
    const queue = new OperationQueue(createDelegate());
    const error = new Error("boom");
    const onError = vi.fn();

    queue.enqueue(
      MediaType.VIDEO,
      op({
        execute: () => {
          throw error;
        },
        onError,
      }),
    );

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("advances past failed operation when sourceBuffer is not updating", () => {
    const queue = new OperationQueue(createDelegate());
    const second = op();

    queue.enqueue(
      MediaType.VIDEO,
      op({
        execute: () => {
          throw new Error("boom");
        },
      }),
    );
    queue.enqueue(MediaType.VIDEO, second);

    expect(second.execute).toHaveBeenCalledOnce();
  });

  it("stalls the queue when execute throws and sourceBuffer is updating", () => {
    const queue = new OperationQueue(createDelegate(true));
    const second = op();

    queue.enqueue(
      MediaType.VIDEO,
      op({
        execute: () => {
          throw new Error("boom");
        },
      }),
    );
    queue.enqueue(MediaType.VIDEO, second);

    expect(second.execute).not.toHaveBeenCalled();
  });

  it("auto-advances sync operations when sourceBuffer is not updating", () => {
    const queue = new OperationQueue(createDelegate());
    const first = op({ kind: OperationKind.QuotaCleanup });
    const second = op();

    queue.enqueue(MediaType.VIDEO, first);
    queue.enqueue(MediaType.VIDEO, second);

    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).toHaveBeenCalledOnce();
  });
});
