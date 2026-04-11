import type {
  InitSegment,
  Manifest,
  Segment,
  SwitchingSet,
  Track,
} from "../../lib/types/manifest";
import { MediaType } from "../../lib/types/media";

export function createInitSegment(
  overrides?: Partial<InitSegment>,
): InitSegment {
  return {
    url: "https://cdn.test/init.mp4",
    ...overrides,
  };
}

export function createSegment(overrides?: Partial<Segment>): Segment {
  return {
    url: "https://cdn.test/seg-1.m4s",
    start: 0,
    end: 4,
    initSegment: createInitSegment(),
    ...overrides,
  };
}

export function createVideoTrack(
  overrides?: Partial<Extract<Track, { type: MediaType.VIDEO }>>,
): Extract<Track, { type: MediaType.VIDEO }> {
  return {
    type: MediaType.VIDEO,
    bandwidth: 2_000_000,
    width: 1920,
    height: 1080,
    segments: [createSegment()],
    ...overrides,
  };
}

export function createAudioTrack(
  overrides?: Partial<Extract<Track, { type: MediaType.AUDIO }>>,
): Extract<Track, { type: MediaType.AUDIO }> {
  return {
    type: MediaType.AUDIO,
    bandwidth: 128_000,
    segments: [createSegment()],
    ...overrides,
  };
}

export function createSwitchingSet(
  overrides?: Partial<SwitchingSet>,
): SwitchingSet {
  return {
    type: MediaType.VIDEO,
    codec: "avc1.64001f",
    tracks: [createVideoTrack()],
    ...overrides,
  };
}

export function createManifest(
  overrides?: Partial<Manifest>,
): Manifest {
  return {
    duration: 60,
    switchingSets: [
      createSwitchingSet(),
      createSwitchingSet({
        type: MediaType.AUDIO,
        codec: "mp4a.40.2",
        tracks: [createAudioTrack()],
      }),
    ],
    ...overrides,
  };
}
