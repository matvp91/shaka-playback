import { describe, expect, it } from "vitest";
import { parseManifest } from "../../lib/dash/dash_parser";
import { MediaType } from "../../lib/types/media";
import { loadFixture } from "../fixtures";

describe("parseManifest", () => {
  const sourceUrl = "https://cdn.test/manifest.mpd";

  it("parses a basic MPD into a manifest with correct duration", () => {
    const manifest = parseManifest(loadFixture("basic.mpd"), sourceUrl);
    expect(manifest.duration).toBe(60);
    expect(manifest.switchingSets).toHaveLength(2);
  });

  it("extracts a video switching set with the declared codec", () => {
    const manifest = parseManifest(loadFixture("basic.mpd"), sourceUrl);
    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    );
    expect(video).toBeDefined();
    expect(video!.codec).toBe("avc1.64001f");
    expect(video!.tracks).toHaveLength(2);
  });

  it("extracts an audio switching set with the declared codec", () => {
    const manifest = parseManifest(loadFixture("basic.mpd"), sourceUrl);
    const audio = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.AUDIO,
    );
    expect(audio).toBeDefined();
    expect(audio!.codec).toBe("mp4a.40.2");
    expect(audio!.tracks).toHaveLength(1);
  });

  it("resolves video track dimensions from representations", () => {
    const manifest = parseManifest(loadFixture("basic.mpd"), sourceUrl);
    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    )!;
    const track1080 = video.tracks.find(
      (t) => t.type === MediaType.VIDEO && t.height === 1080,
    );
    const track720 = video.tracks.find(
      (t) => t.type === MediaType.VIDEO && t.height === 720,
    );
    expect(track1080).toBeDefined();
    expect(track720).toBeDefined();
  });

  it("generates segments with URLs derived from the SegmentTemplate", () => {
    const manifest = parseManifest(loadFixture("basic.mpd"), sourceUrl);
    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    )!;
    const track = video.tracks[0]!;
    expect(track.segments.length).toBeGreaterThan(0);

    const firstSeg = track.segments[0]!;
    expect(firstSeg.url).toContain("video-");
    expect(firstSeg.start).toBe(0);
    expect(firstSeg.initSegment.url).toContain("video-init.mp4");
  });

  it("generates the correct number of segments for the presentation duration", () => {
    const manifest = parseManifest(loadFixture("basic.mpd"), sourceUrl);
    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    )!;
    const track = video.tracks[0]!;
    // 60s duration / 4s segments = 15 segments
    expect(track.segments).toHaveLength(15);
  });
});
