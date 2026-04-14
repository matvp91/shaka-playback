import { describe, expect, it } from "vitest";
import { deepMerge, unflattenPath } from "../../lib/utils/object_utils";

describe("ObjectUtils", () => {
  describe("deepMerge", () => {
    it("merges top-level primitives", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, { a: 10 });
      expect(result).toEqual({ a: 10, b: 2 });
    });

    it("deep-merges nested objects", () => {
      const target = { net: { maxAttempts: 3, delay: 1000 } };
      const result = deepMerge(target, { net: { delay: 500 } });
      expect(result).toEqual({ net: { maxAttempts: 3, delay: 500 } });
    });

    it("replaces arrays instead of merging them", () => {
      const target = { items: [1, 2, 3] };
      const result = deepMerge(target, { items: [4, 5] });
      expect(result).toEqual({ items: [4, 5] });
    });

    it("returns a new object without mutating the target", () => {
      const target = { a: 1, nested: { b: 2 } };
      const result = deepMerge(target, { a: 10 });
      expect(result).not.toBe(target);
      expect(target.a).toBe(1);
    });

    it("does not mutate nested objects in the target", () => {
      const nested = { b: 2, c: 3 };
      const target = { nested };
      deepMerge(target, { nested: { b: 20 } });
      expect(nested.b).toBe(2);
    });

    it("replaces a nested object with null", () => {
      const target = { a: { b: 1 } };
      const result = deepMerge(target, { a: null });
      expect(result).toEqual({ a: null });
    });

    it("handles an empty source", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, {});
      expect(result).toEqual({ a: 1, b: 2 });
    });
  });

  describe("unflattenPath", () => {
    it("creates a nested object from a single key", () => {
      expect(unflattenPath("a", { value: 1 })).toEqual({ a: { value: 1 } });
    });

    it("creates a deeply nested object from a dot path", () => {
      expect(unflattenPath("a.b.c", { value: 1 })).toEqual({
        a: { b: { c: { value: 1 } } },
      });
    });

    it("wraps a primitive value at a dot path", () => {
      expect(unflattenPath("a.b", 42)).toEqual({ a: { b: 42 } });
    });
  });
});
