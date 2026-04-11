import { describe, expect, it } from "vitest";
import { filterMap, findMap } from "../../lib/utils/functional";

describe("findMap", () => {
  it("returns first non-null result from function", () => {
    const items = [1, 2, 3];
    const result = findMap(items, (n) =>
      n > 1 ? `found-${n}` : undefined,
    );
    expect(result).toBe("found-2");
  });

  it("returns undefined when no match", () => {
    const result = findMap([1, 2], () => undefined);
    expect(result).toBeUndefined();
  });

  it("returns first non-null property by key", () => {
    const items = [
      { name: undefined },
      { name: "alice" },
      { name: "bob" },
    ];
    const result = findMap(items, "name");
    expect(result).toBe("alice");
  });

  it("returns undefined for empty array", () => {
    const result = findMap([], (x) => x);
    expect(result).toBeUndefined();
  });
});

describe("filterMap", () => {
  it("collects non-null results from function", () => {
    const items = [1, 2, 3, 4];
    const result = filterMap(items, (n) =>
      n % 2 === 0 ? n * 10 : undefined,
    );
    expect(result).toEqual([20, 40]);
  });

  it("returns empty array when nothing matches", () => {
    const result = filterMap([1, 2], () => null);
    expect(result).toEqual([]);
  });

  it("collects non-null properties by key", () => {
    const items = [
      { val: "a" },
      { val: undefined },
      { val: "c" },
    ];
    const result = filterMap(items, "val");
    expect(result).toEqual(["a", "c"]);
  });
});
