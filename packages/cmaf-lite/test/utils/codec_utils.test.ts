import { describe, expect, it } from "vitest";
import {
  getCodecBase,
  getCodecProfile,
  getContentType,
  getNormalizedCodec,
} from "../../lib/utils/codec_utils";
import { MediaType } from "../../lib/types/media";

describe("getContentType", () => {
  it("returns MIME type string with codec for given track type", () => {
    expect(getContentType(MediaType.VIDEO, "avc1.64001f")).toBe(
      'video/mp4; codecs="avc1.64001f"',
    );
  });
});

describe("getCodecBase", () => {
  it("returns the codec base name before the dot", () => {
    expect(getCodecBase("avc1.64001f")).toBe("avc1");
  });

  it("returns the full codec string when no dot is present", () => {
    expect(getCodecBase("ac-3")).toBe("ac-3");
  });
});

describe("getCodecProfile", () => {
  it("returns the codec profile substring after the dot", () => {
    expect(getCodecProfile("avc1.64001f")).toBe("64001f");
  });

  it("returns null when no dot", () => {
    expect(getCodecProfile("ac-3")).toBeNull();
  });
});

describe("getNormalizedCodec", () => {
  it("normalizes AAC variants to 'aac'", () => {
    expect(getNormalizedCodec("mp4a.40.2")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.02")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.5")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.05")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.29")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.42")).toBe("aac");
    expect(getNormalizedCodec("mp4a.66")).toBe("aac");
    expect(getNormalizedCodec("mp4a.67")).toBe("aac");
    expect(getNormalizedCodec("mp4a.68")).toBe("aac");
  });

  it("normalizes AVC variants to 'avc'", () => {
    expect(getNormalizedCodec("avc1.64001f")).toBe("avc");
    expect(getNormalizedCodec("avc3.640028")).toBe("avc");
  });

  it("normalizes HEVC variants to 'hevc'", () => {
    expect(getNormalizedCodec("hev1.1.6.L93")).toBe("hevc");
    expect(getNormalizedCodec("hvc1.1.6.L93")).toBe("hevc");
  });

  it("normalizes AV1 variants to 'av1'", () => {
    expect(getNormalizedCodec("av01.0.04M.08")).toBe("av1");
  });

  it("passes through Dolby codec strings unchanged", () => {
    expect(getNormalizedCodec("ac-3")).toBe("ac-3");
    expect(getNormalizedCodec("ec-3")).toBe("ec-3");
  });

  it("normalizes codec strings regardless of input case", () => {
    expect(getNormalizedCodec("AVC1.64001F")).toBe("avc");
    expect(getNormalizedCodec("MP4A.40.2")).toBe("aac");
  });

  it("throws on unsupported codec", () => {
    expect(() => getNormalizedCodec("vp9")).toThrow(
      "Unsupported codec: vp9",
    );
  });
});
