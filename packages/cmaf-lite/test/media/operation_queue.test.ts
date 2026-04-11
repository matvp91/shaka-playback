import { describe, expect, it, vi } from "vitest";
import { OperationQueue } from "../../lib/media/operation_queue";
import { MediaType } from "../../lib/types/media";

function createMockSourceBuffer(): SourceBuffer {
  return { updating: false } as unknown as SourceBuffer;
}

describe("OperationQueue", () => {
  it("executes the first enqueued operation immediately", () => {
    const queue = new OperationQueue();
    queue.add(MediaType.VIDEO, createMockSourceBuffer());

    const execute = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("defers subsequent operations until the current one completes", () => {
    const queue = new OperationQueue();
    queue.add(MediaType.VIDEO, createMockSourceBuffer());

    const first = vi.fn();
    const second = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute: first });
    queue.enqueue(MediaType.VIDEO, { execute: second });

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("calls onComplete and advances to the next operation on shiftAndExecuteNext", () => {
    const queue = new OperationQueue();
    queue.add(MediaType.VIDEO, createMockSourceBuffer());

    const first = vi.fn();
    const second = vi.fn();
    const onComplete = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute: first, onComplete });
    queue.enqueue(MediaType.VIDEO, { execute: second });

    queue.shiftAndExecuteNext(MediaType.VIDEO);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("executes inserted operations before previously queued ones", () => {
    const queue = new OperationQueue();
    queue.add(MediaType.VIDEO, createMockSourceBuffer());

    const order: number[] = [];
    // op1 executes immediately; op3 is pending behind it
    queue.enqueue(MediaType.VIDEO, { execute: () => order.push(1) });
    queue.enqueue(MediaType.VIDEO, { execute: () => order.push(3) });
    // insertNext unshifts op2 before op3 while op1 is still current
    // executeNext_ runs op2 immediately since op1 is already "running"
    queue.insertNext(MediaType.VIDEO, [
      { execute: () => order.push(2) },
    ]);
    // shift op2, run op1 (index 1); shift op1, run op3
    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);

    // op1 at enqueue, op2 at insertNext, op1 runs again (was still in queue), op3 last
    expect(order).toEqual([1, 2, 1, 3]);
  });

  it("resolves block promise when it reaches the front of the queue", async () => {
    const queue = new OperationQueue();
    queue.add(MediaType.VIDEO, createMockSourceBuffer());

    await queue.block(MediaType.VIDEO);
  });

  it("resolves block immediately when the media type is not registered", async () => {
    const queue = new OperationQueue();
    await queue.block(MediaType.VIDEO);
  });

  it("calls onError with the thrown error when execute fails", () => {
    const queue = new OperationQueue();
    queue.add(MediaType.VIDEO, createMockSourceBuffer());

    const error = new Error("boom");
    const onError = vi.fn();
    queue.enqueue(MediaType.VIDEO, {
      execute: () => { throw error; },
      onError,
    });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("silently ignores enqueue for an unregistered media type", () => {
    const queue = new OperationQueue();
    const execute = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute });
    expect(execute).not.toHaveBeenCalled();
  });

  it("clears all queues on destroy so new enqueues are ignored", () => {
    const queue = new OperationQueue();
    queue.add(MediaType.VIDEO, createMockSourceBuffer());
    queue.enqueue(MediaType.VIDEO, { execute: vi.fn() });

    queue.destroy();

    const execute = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute });
    expect(execute).not.toHaveBeenCalled();
  });
});
