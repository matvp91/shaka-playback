import type {
  Manifest,
  Presentation,
  Stream,
  StreamPreference,
  Track,
} from "../types";
import { MediaType } from "../types";
import { assert, assertNotVoid } from "./assert";

export type TrackSelection = {
  track: Track;
  stream: Stream;
};

/**
 * Derive the set of streams available across all
 * presentations. Only streams present in every
 * presentation are included (intersection).
 */
export function getStreams(manifest: Manifest): Stream[] {
  assert(manifest.presentations.length > 0, "No presentations");
  const sets = manifest.presentations.map(collectStreams);
  const result = sets.reduce(intersect);
  assert(result.length > 0, "No consistent streams across presentations");
  return result;
}

/**
 * Select the best track for a media type in a
 * presentation. With a preference, matches the closest
 * stream then resolves to a track. Without, returns
 * the first track.
 */
export function selectTrack(
  streams: Stream[],
  presentation: Presentation,
  type: MediaType,
  preference?: StreamPreference,
): TrackSelection {
  if (!preference) {
    return getFirstTrack(streams, presentation, type);
  }

  const filtered = streams.filter(
    (s): s is Stream & { type: typeof type } => s.type === type,
  );
  const stream = matchPreference(filtered, preference);
  const track = resolveTrack(presentation, type, stream);
  return { track, stream };
}

function collectStreams(presentation: Presentation): Stream[] {
  const streams: Stream[] = [];
  for (const selectionSet of presentation.selectionSets) {
    for (const switchingSet of selectionSet.switchingSets) {
      for (const track of switchingSet.tracks) {
        const stream = toStream(track, switchingSet.codec);
        if (!streams.some((s) => isSameStream(s, stream))) {
          streams.push(stream);
        }
      }
    }
  }
  return streams;
}

function toStream(track: Track, codec: string): Stream {
  if (track.type === MediaType.VIDEO) {
    return {
      type: track.type,
      codec,
      width: track.width,
      height: track.height,
    };
  }
  return { type: track.type, codec };
}

function isSameStream(a: Stream, b: Stream): boolean {
  if (a.type !== b.type || a.codec !== b.codec) {
    return false;
  }
  if (a.type === MediaType.VIDEO && b.type === MediaType.VIDEO) {
    return a.width === b.width && a.height === b.height;
  }
  return true;
}

function intersect(a: Stream[], b: Stream[]): Stream[] {
  return a.filter((s) => b.some((t) => isSameStream(s, t)));
}

type VideoStream = Stream & { type: MediaType.VIDEO };
type AudioStream = Stream & { type: MediaType.AUDIO };

/**
 * Match a preference to the closest stream. For video,
 * closest by height, then width. For audio, first match
 * by codec or first available.
 */
function matchPreference(
  streams: Stream[],
  preference: StreamPreference,
): Stream {
  assertNotVoid(streams[0], "No streams to match against");

  if (preference.type === MediaType.VIDEO) {
    return matchVideoPreference(streams as VideoStream[], preference);
  }

  return matchAudioPreference(streams as AudioStream[], preference);
}

function matchVideoPreference(
  streams: VideoStream[],
  preference: {
    type: MediaType.VIDEO;
    codec?: string;
    width?: number;
    height?: number;
  },
): Stream {
  assertNotVoid(streams[0], "No video streams to match against");
  let best: VideoStream = streams[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const stream of streams) {
    let dist = 0;
    if (preference.height !== undefined) {
      dist += Math.abs(stream.height - preference.height);
    }
    if (preference.width !== undefined) {
      dist += Math.abs(stream.width - preference.width);
    }
    if (preference.codec !== undefined && stream.codec !== preference.codec) {
      dist += 1_000_000;
    }
    if (dist < bestDist) {
      best = stream;
      bestDist = dist;
    }
  }

  return best;
}

function matchAudioPreference(
  streams: AudioStream[],
  preference: { type: MediaType.AUDIO; codec?: string },
): Stream {
  if (preference.codec) {
    const match = streams.find((s) => s.codec === preference.codec);
    if (match) {
      return match;
    }
  }
  assertNotVoid(streams[0], "No audio streams to match against");
  return streams[0];
}

function resolveTrack(
  presentation: Presentation,
  type: MediaType,
  stream: Stream,
): Track {
  for (const selectionSet of presentation.selectionSets) {
    if (selectionSet.type !== type) {
      continue;
    }
    for (const switchingSet of selectionSet.switchingSets) {
      if (switchingSet.codec !== stream.codec) {
        continue;
      }
      for (const track of switchingSet.tracks) {
        if (isTrackMatch(track, stream)) {
          return track;
        }
      }
    }
  }

  throw new Error(`No track found for stream in presentation`);
}

function isTrackMatch(track: Track, stream: Stream): boolean {
  if (track.type !== stream.type) {
    return false;
  }
  if (track.type === MediaType.VIDEO && stream.type === MediaType.VIDEO) {
    return track.width === stream.width && track.height === stream.height;
  }
  return true;
}

function getFirstTrack(
  streams: Stream[],
  presentation: Presentation,
  type: MediaType,
): TrackSelection {
  const selectionSet = presentation.selectionSets.find((s) => s.type === type);
  assertNotVoid(selectionSet, `No SelectionSet for ${type}`);

  const switchingSet = selectionSet.switchingSets[0];
  assertNotVoid(switchingSet, "No SwitchingSet");

  const track = switchingSet.tracks[0];
  assertNotVoid(track, "No Track");

  const stream = streams.find(
    (s) => s.type === type && s.codec === switchingSet.codec,
  );
  assertNotVoid(stream, `No stream for ${type}`);

  return { track, stream };
}
