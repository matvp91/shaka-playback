import { describe, expect, it } from "vitest";
import { MediaType } from "../../lib/types/media";
import { buildStreams, selectStream } from "../../lib/utils/stream_utils";
import {
  createAudioTrack,
  createManifest,
  createSwitchingSet,
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
        switchingSets: [createSwitchingSet({ tracks: [track, track] })],
      });
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(1);
    });

    it("throws when manifest has no switching sets", () => {
      const manifest = createManifest({ switchingSets: [] });
      expect(() => buildStreams(manifest)).toThrow("No streams found");
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
      const streams = buildStreams(manifest);
      expect(streams.get(MediaType.VIDEO)).toHaveLength(2);
    });
  });

  describe("selectStream", () => {
    const manifest = createManifest({
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
    });
    const streamsByType = buildStreams(manifest);
    const videoStreams = streamsByType.get(MediaType.VIDEO)!;
    const audioStreams = streamsByType.get(MediaType.AUDIO)!;

    it("selects the video stream closest to preferred height", () => {
      const stream = selectStream(videoStreams, {
        type: MediaType.VIDEO,
        height: 700,
      });
      expect(stream.type).toBe(MediaType.VIDEO);
      if (stream.type === MediaType.VIDEO) {
        expect(stream.height).toBe(720);
      }
    });

    it("selects an audio stream matching the preferred codec", () => {
      const stream = selectStream(audioStreams, {
        type: MediaType.AUDIO,
        codec: "aac",
      });
      expect(stream.type).toBe(MediaType.AUDIO);
      expect(stream.codec).toBe("aac");
    });

    it("penalizes codec mismatch when selecting video streams", () => {
      const multiCodecStreams = buildStreams(
        createManifest({
          switchingSets: [
            createSwitchingSet({
              codec: "avc1.64001f",
              tracks: [createVideoTrack({ width: 1920, height: 1080 })],
            }),
            createSwitchingSet({
              codec: "hev1.1.6.L93",
              tracks: [createVideoTrack({ width: 1920, height: 1080 })],
            }),
          ],
        }),
      ).get(MediaType.VIDEO)!;
      const stream = selectStream(multiCodecStreams, {
        type: MediaType.VIDEO,
        codec: "hevc",
      });
      expect(stream.codec).toBe("hevc");
    });

    it("selects video stream closest to preferred width", () => {
      const stream = selectStream(videoStreams, {
        type: MediaType.VIDEO,
        width: 1300,
      });
      expect(stream.type).toBe(MediaType.VIDEO);
      if (stream.type === MediaType.VIDEO) {
        expect(stream.width).toBe(1280);
      }
    });

    it("falls back to the first audio stream when preferred codec is unavailable", () => {
      const stream = selectStream(audioStreams, {
        type: MediaType.AUDIO,
        codec: "nonexistent",
      });
      expect(stream.type).toBe(MediaType.AUDIO);
    });
  });
});
