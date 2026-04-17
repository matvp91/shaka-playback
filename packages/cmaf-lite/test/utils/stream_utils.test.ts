import { describe, expect, it } from "vitest";
import { MediaType } from "../../lib/types/media";
import type { Preference, VideoStream } from "../../lib/types/media";
import {
  buildStreams,
  findStreamsMatchingPreferences,
} from "../../lib/utils/stream_utils";
import {
  createManifest,
  createVideoSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";

describe("findStreamsMatchingPreferences", () => {
  const videoStreams = (): VideoStream[] => {
    const manifest = createManifest({
      switchingSets: [
        createVideoSwitchingSet({
          codec: "avc1.64001f",
          tracks: [
            createVideoTrack({ bandwidth: 1_000_000 }),
            createVideoTrack({ bandwidth: 3_000_000, width: 1280, height: 720 }),
          ],
        }),
        createVideoSwitchingSet({
          codec: "av01.0.05M.08",
          tracks: [createVideoTrack({ bandwidth: 2_000_000 })],
        }),
      ],
    });
    const list = buildStreams(manifest).get(MediaType.VIDEO) ?? [];
    return list.filter((s): s is VideoStream => s.type === MediaType.VIDEO);
  };

  it("returns all matching streams for the first type-matching preference", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.VIDEO, codec: "avc1.64001f" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(2);
    expect(result!.every((s: VideoStream) => s.codec === "avc")).toBe(true);
  });

  it("skips preferences whose type does not match the requested type", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.AUDIO, codec: "mp4a.40.2" },
      { type: MediaType.VIDEO, codec: "av01.0.05M.08" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(1);
    expect(result![0]!.codec).toBe("av1");
  });

  it("returns the match set for the earliest preference that yields hits", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.VIDEO, codec: "hev1.2.4.L120.90" },
      { type: MediaType.VIDEO, codec: "avc1.64001f" },
      { type: MediaType.VIDEO, codec: "av01.0.05M.08" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(2);
    expect(result!.every((s: VideoStream) => s.codec === "avc")).toBe(true);
  });

  it("returns null when no preference matches any stream", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.VIDEO, codec: "hev1.2.4.L120.90" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toBeNull();
  });

  it("returns null when preferences list is empty", () => {
    const streams = videoStreams();
    const result = findStreamsMatchingPreferences(MediaType.VIDEO, streams, []);
    expect(result).toBeNull();
  });

  it("treats an undefined codec field as an unconstrained match", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [{ type: MediaType.VIDEO }];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(streams.length);
  });
});

describe("StreamUtils", () => {
  describe("buildStreams", () => {
    it("extracts one stream per unique type and resolution", () => {
      const manifest = createManifest();
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(1);
      expect(streams.get(MediaType.AUDIO)).toHaveLength(1);
    });

    it("wires hierarchy to the manifest's own switching set and track", () => {
      const manifest = createManifest();
      const streams = buildStreams(manifest);
      const videoStream = streams.get(MediaType.VIDEO)![0]!;
      const expectedSwitchingSet = manifest.switchingSets.find(
        (ss) => ss.type === MediaType.VIDEO,
      )!;
      const expectedTrack = expectedSwitchingSet.tracks[0]!;
      expect(videoStream.hierarchy.switchingSet).toBe(expectedSwitchingSet);
      expect(videoStream.hierarchy.track).toBe(expectedTrack);
    });

    it("deduplicates streams with identical type, codec, and resolution", () => {
      const track = createVideoTrack();
      const manifest = createManifest({
        switchingSets: [createVideoSwitchingSet({ tracks: [track, track] })],
      });
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(1);
    });

    it("throws when manifest has no switching sets", () => {
      const manifest = createManifest({ switchingSets: [] });
      expect(() => buildStreams(manifest)).toThrow("No streams found");
    });

    it("sorts streams by bandwidth ascending for ABR", () => {
      const manifest = createManifest({
        switchingSets: [
          createVideoSwitchingSet({
            tracks: [
              createVideoTrack({
                bandwidth: 5_000_000,
                width: 1920,
                height: 1080,
              }),
              createVideoTrack({
                bandwidth: 1_000_000,
                width: 640,
                height: 360,
              }),
              createVideoTrack({
                bandwidth: 3_000_000,
                width: 1280,
                height: 720,
              }),
            ],
          }),
        ],
      });
      const streams = buildStreams(manifest);
      const video = streams.get(MediaType.VIDEO)!;
      const bandwidths = video.map((s) => s.bandwidth);
      expect(bandwidths).toEqual([1_000_000, 3_000_000, 5_000_000]);
    });

    it("produces separate streams for tracks with different resolutions", () => {
      const manifest = createManifest({
        switchingSets: [
          createVideoSwitchingSet({
            tracks: [
              createVideoTrack({ width: 1920, height: 1080 }),
              createVideoTrack({ width: 1280, height: 720 }),
            ],
          }),
        ],
      });
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(2);
    });
  });
});
