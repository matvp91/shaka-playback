import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timer } from "../../lib/utils/timer";

describe("Timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires callback after the specified delay in seconds", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickAfter(2);

    vi.advanceTimersByTime(1999);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("fires callback synchronously when tickNow is called", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickNow();

    expect(callback).toHaveBeenCalledOnce();
  });

  it("fires callback repeatedly at the specified interval", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickEvery(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(3);

    timer.stop();
  });

  it("cancels pending tick when stop is called", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickAfter(1);
    timer.stop();

    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("stops repeating when stop is called inside callback", () => {
    let count = 0;
    const timer = new Timer(() => {
      count++;
      timer.stop();
    });
    timer.tickEvery(1);

    vi.advanceTimersByTime(5000);
    expect(count).toBe(1);
  });

  it("replaces a pending tick when tickAfter is called again", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickAfter(5);
    timer.tickAfter(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledOnce();
  });
});
