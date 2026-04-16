import { describe, expect, it } from "vitest";
import { MediaType } from "../../lib/types/media";
import { buildStreams } from "../../lib/utils/stream_utils";
import {
  createManifest,
  createVideoSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";

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
