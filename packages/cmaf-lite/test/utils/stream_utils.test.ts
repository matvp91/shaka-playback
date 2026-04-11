import { describe, expect, it } from "vitest";
import {
  getStreams,
  remapSegment,
  resolveHierarchy,
  selectStream,
} from "../../lib/utils/stream_utils";
import { MediaType } from "../../lib/types/media";
import {
  createAudioTrack,
  createManifest,
  createSegment,
  createSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";

describe("getStreams", () => {
  it("extracts one stream per unique type and resolution", () => {
    const manifest = createManifest();
    const streams = getStreams(manifest);
    expect(streams).toHaveLength(2);
    expect(streams[0]!.type).toBe(MediaType.VIDEO);
    expect(streams[1]!.type).toBe(MediaType.AUDIO);
  });

  it("deduplicates streams with identical type, codec, and resolution", () => {
    const track = createVideoTrack();
    const manifest = createManifest({
      switchingSets: [
        createSwitchingSet({ tracks: [track, track] }),
      ],
    });
    const streams = getStreams(manifest);
    const videoStreams = streams.filter(
      (s) => s.type === MediaType.VIDEO,
    );
    expect(videoStreams).toHaveLength(1);
  });

  it("produces separate streams for tracks with different resolutions", () => {
    const manifest = createManifest({
      switchingSets: [
        createSwitchingSet({
          tracks: [
            createVideoTrack({ width: 1920, height: 1080 }),
            createVideoTrack({ width: 1280, height: 720 }),
          ],
        }),
      ],
    });
    const streams = getStreams(manifest);
    expect(streams).toHaveLength(2);
  });
});

describe("selectStream", () => {
  const streams = getStreams(createManifest({
    switchingSets: [
      createSwitchingSet({
        tracks: [
          createVideoTrack({ width: 1920, height: 1080 }),
          createVideoTrack({ width: 1280, height: 720 }),
        ],
      }),
      createSwitchingSet({
        type: MediaType.AUDIO,
        codec: "mp4a.40.2",
        tracks: [createAudioTrack()],
      }),
    ],
  }));

  it("selects the video stream closest to preferred height", () => {
    const stream = selectStream(streams, {
      type: MediaType.VIDEO,
      height: 700,
    });
    expect(stream.type).toBe(MediaType.VIDEO);
    if (stream.type === MediaType.VIDEO) {
      expect(stream.height).toBe(720);
    }
  });

  it("selects an audio stream matching the preferred codec", () => {
    const stream = selectStream(streams, {
      type: MediaType.AUDIO,
      codec: "aac",
    });
    expect(stream.type).toBe(MediaType.AUDIO);
    expect(stream.codec).toBe("aac");
  });

  it("falls back to the first audio stream when preferred codec is unavailable", () => {
    const stream = selectStream(streams, {
      type: MediaType.AUDIO,
      codec: "nonexistent",
    });
    expect(stream.type).toBe(MediaType.AUDIO);
  });
});

describe("resolveHierarchy", () => {
  it("resolves the switching set and track for a given stream", () => {
    const manifest = createManifest();
    const streams = getStreams(manifest);
    const [switchingSet, track] = resolveHierarchy(
      manifest,
      streams[0]!,
    );
    expect(switchingSet.type).toBe(MediaType.VIDEO);
    expect(track.type).toBe(MediaType.VIDEO);
  });

  it("throws when no switching set matches the stream", () => {
    const manifest = createManifest({
      switchingSets: [createSwitchingSet()],
    });
    expect(() =>
      resolveHierarchy(manifest, {
        type: MediaType.AUDIO,
        codec: "aac",
      }),
    ).toThrow("No matching hierarchy");
  });
});

describe("remapSegment", () => {
  it("maps a segment to the same index in a different track", () => {
    const seg0 = createSegment({ url: "old-0.m4s", start: 0, end: 4 });
    const seg1 = createSegment({ url: "old-1.m4s", start: 4, end: 8 });
    const newSeg0 = createSegment({ url: "new-0.m4s", start: 0, end: 4 });
    const newSeg1 = createSegment({ url: "new-1.m4s", start: 4, end: 8 });

    const oldTrack = createVideoTrack({ segments: [seg0, seg1] });
    const newTrack = createVideoTrack({ segments: [newSeg0, newSeg1] });

    expect(remapSegment(oldTrack, newTrack, seg1)).toBe(newSeg1);
  });

  it("throws when the segment does not exist in the old track", () => {
    const oldTrack = createVideoTrack({ segments: [createSegment()] });
    const newTrack = createVideoTrack({ segments: [createSegment()] });
    const orphan = createSegment({ url: "orphan.m4s" });

    expect(() => remapSegment(oldTrack, newTrack, orphan)).toThrow(
      "Segment not found",
    );
  });
});
