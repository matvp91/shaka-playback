import { describe, expect, it } from "vitest";
import { MediaType } from "../../lib/types/media";
import {
  getStreams,
  resolveHierarchy,
  selectStream,
} from "../../lib/utils/stream_utils";
import {
  createAudioTrack,
  createManifest,
  createSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";

describe("StreamUtils", () => {
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
        switchingSets: [createSwitchingSet({ tracks: [track, track] })],
      });
      const streams = getStreams(manifest);
      const videoStreams = streams.filter((s) => s.type === MediaType.VIDEO);
      expect(videoStreams).toHaveLength(1);
    });

    it("throws when manifest has no switching sets", () => {
      const manifest = createManifest({ switchingSets: [] });
      expect(() => getStreams(manifest)).toThrow("No streams found");
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
    const streams = getStreams(
      createManifest({
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
      }),
    );

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

    it("penalizes codec mismatch when selecting video streams", () => {
      const multiCodecStreams = getStreams(
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
      );
      const stream = selectStream(multiCodecStreams, {
        type: MediaType.VIDEO,
        codec: "hevc",
      });
      expect(stream.codec).toBe("hevc");
    });

    it("selects video stream closest to preferred width", () => {
      const stream = selectStream(streams, {
        type: MediaType.VIDEO,
        width: 1300,
      });
      expect(stream.type).toBe(MediaType.VIDEO);
      if (stream.type === MediaType.VIDEO) {
        expect(stream.width).toBe(1280);
      }
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
      const [switchingSet, track] = resolveHierarchy(manifest, streams[0]!);
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
          bandwidth: 128_000,
        }),
      ).toThrow("No matching hierarchy");
    });
  });
});
