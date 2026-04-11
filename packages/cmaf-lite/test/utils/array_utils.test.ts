import { describe, expect, it } from "vitest";
import { binarySearch } from "../../lib/utils/array_utils";

describe("ArrayUtils", () => {
  describe("binarySearch", () => {
    const items = [10, 20, 30, 40, 50];

    it("returns the matching element when comparator returns 0", () => {
      const result = binarySearch(items, (item) =>
        item === 30 ? 0 : item < 30 ? 1 : -1,
      );
      expect(result).toBe(30);
    });

    it("returns null when no match exists", () => {
      const result = binarySearch(items, (item) =>
        item === 35 ? 0 : item < 35 ? 1 : -1,
      );
      expect(result).toBeNull();
    });

    it("returns null for empty array", () => {
      const result = binarySearch([], () => 0);
      expect(result).toBeNull();
    });

    it("returns the first element when it satisfies the comparator", () => {
      const result = binarySearch(items, (item) =>
        item === 10 ? 0 : item < 10 ? 1 : -1,
      );
      expect(result).toBe(10);
    });

    it("returns the last element when it satisfies the comparator", () => {
      const result = binarySearch(items, (item) =>
        item === 50 ? 0 : item < 50 ? 1 : -1,
      );
      expect(result).toBe(50);
    });

    it("returns the sole element when it satisfies the comparator", () => {
      const result = binarySearch([42], (item) =>
        item === 42 ? 0 : item < 42 ? 1 : -1,
      );
      expect(result).toBe(42);
    });

    it("returns the matching object when comparator targets a property", () => {
      const items = [{ time: 0 }, { time: 4 }, { time: 8 }];
      const result = binarySearch(items, (item) =>
        item.time === 4 ? 0 : item.time < 4 ? 1 : -1,
      );
      expect(result).toEqual({ time: 4 });
    });
  });
});
