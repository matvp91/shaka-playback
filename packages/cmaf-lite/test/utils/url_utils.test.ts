import { describe, expect, it } from "vitest";
import {
  isAbsoluteUrl,
  resolveUrl,
  resolveUrls,
} from "../../lib/utils/url_utils";

describe("isAbsoluteUrl", () => {
  it("returns true for https", () => {
    expect(isAbsoluteUrl("https://cdn.test/video.mp4")).toBe(true);
  });

  it("returns true for http", () => {
    expect(isAbsoluteUrl("http://cdn.test/video.mp4")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isAbsoluteUrl("video/seg-1.m4s")).toBe(false);
  });
});

describe("resolveUrl", () => {
  it("returns the url unchanged when no base is provided", () => {
    expect(resolveUrl("seg.m4s")).toBe("seg.m4s");
  });

  it("returns the url unchanged when url is already absolute", () => {
    expect(resolveUrl("https://a.test/seg.m4s", "https://b.test/")).toBe(
      "https://a.test/seg.m4s",
    );
  });

  it("resolves against absolute base", () => {
    expect(resolveUrl("seg.m4s", "https://cdn.test/video/")).toBe(
      "https://cdn.test/video/seg.m4s",
    );
  });

  it("concatenates with non-absolute base ending in slash", () => {
    expect(resolveUrl("seg.m4s", "video/")).toBe("video/seg.m4s");
  });

  it("inserts separator when non-absolute base lacks trailing slash", () => {
    expect(resolveUrl("seg.m4s", "video")).toBe("video/seg.m4s");
  });
});

describe("resolveUrls", () => {
  it("resolves each url against the previous to produce a final url", () => {
    const result = resolveUrls(["https://cdn.test/", "video/", "seg-1.m4s"]);
    expect(result).toBe("https://cdn.test/video/seg-1.m4s");
  });

  it("returns empty string for empty array", () => {
    expect(resolveUrls([])).toBe("");
  });
});
