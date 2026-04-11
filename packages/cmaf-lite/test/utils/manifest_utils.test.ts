import { describe, expect, it } from "vitest";
import {
  getSwitchingSetId,
  getTrackId,
  isInitSegment,
  isMediaSegment,
} from "../../lib/utils/manifest_utils";
import { MediaType } from "../../lib/types/media";
import {
  createInitSegment,
  createSegment,
  createVideoTrack,
  createAudioTrack,
} from "../__framework__/factories";

describe("isMediaSegment", () => {
  it("returns true for a media segment", () => {
    expect(isMediaSegment(createSegment())).toBe(true);
  });

  it("returns false for an init segment", () => {
    expect(isMediaSegment(createInitSegment())).toBe(false);
  });
});

describe("isInitSegment", () => {
  it("returns true for an init segment", () => {
    expect(isInitSegment(createInitSegment())).toBe(true);
  });

  it("returns false for a media segment", () => {
    expect(isInitSegment(createSegment())).toBe(false);
  });
});

describe("getSwitchingSetId", () => {
  it("returns a colon-joined string of media type and codec", () => {
    expect(getSwitchingSetId(MediaType.VIDEO, "avc")).toBe(
      "video:avc",
    );
  });
});

describe("getTrackId", () => {
  it("returns dimensions for video tracks", () => {
    const track = createVideoTrack({ width: 1280, height: 720 });
    expect(getTrackId(track)).toBe("video:1280:720");
  });

  it("returns 'audio' for audio tracks", () => {
    expect(getTrackId(createAudioTrack())).toBe("audio");
  });
});
