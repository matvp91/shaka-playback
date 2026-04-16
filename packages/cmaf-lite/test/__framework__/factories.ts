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
  overrides?: Partial<Track<MediaType.VIDEO>>,
): Track<MediaType.VIDEO> {
  return {
    type: MediaType.VIDEO,
    bandwidth: 2_000_000,
    width: 1920,
    height: 1080,
    segments: [createSegment()],
    maxSegmentDuration: 4,
    ...overrides,
  };
}

export function createAudioTrack(
  overrides?: Partial<Track<MediaType.AUDIO>>,
): Track<MediaType.AUDIO> {
  return {
    type: MediaType.AUDIO,
    bandwidth: 128_000,
    segments: [createSegment()],
    maxSegmentDuration: 4,
    ...overrides,
  };
}

export function createVideoSwitchingSet(
  overrides?: Partial<SwitchingSet<MediaType.VIDEO>>,
): SwitchingSet<MediaType.VIDEO> {
  return {
    type: MediaType.VIDEO,
    codec: "avc1.64001f",
    tracks: [createVideoTrack()],
    ...overrides,
  };
}

export function createAudioSwitchingSet(
  overrides?: Partial<SwitchingSet<MediaType.AUDIO>>,
): SwitchingSet<MediaType.AUDIO> {
  return {
    type: MediaType.AUDIO,
    codec: "mp4a.40.2",
    tracks: [createAudioTrack()],
    ...overrides,
  };
}

export function createManifest(overrides?: Partial<Manifest>): Manifest {
  return {
    duration: 60,
    switchingSets: [createVideoSwitchingSet(), createAudioSwitchingSet()],
    ...overrides,
  };
}
