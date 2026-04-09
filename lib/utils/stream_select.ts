import type {
  Manifest,
  Presentation,
  Stream,
  StreamPreference,
  Track,
} from "../types";
import { MediaType } from "../types";
import type { ByType } from "../types/utils";
import { assert, assertNotVoid } from "./assert";

/**
 * Derive the set of streams available across all
 * presentations. Only streams present in every
 * presentation are included (intersection).
 */
export function getStreams(manifest: Manifest): Stream[] {
  assert(manifest.presentations.length > 0, "No presentations");

  const sets = manifest.presentations.map((presentation) => {
    const streams: Stream[] = [];
    for (const switchingSet of presentation.switchingSets) {
      for (const track of switchingSet.tracks) {
        const stream = trackToStream(track, switchingSet.codec);
        if (!streams.some((s) => isSameStream(s, stream))) {
          streams.push(stream);
        }
      }
    }
    return streams;
  });

  const result = sets.reduce((a, b) =>
    a.filter((s) => b.some((t) => isSameStream(s, t))),
  );
  assert(result.length > 0, "No consistent streams across presentations");
  return result;
}

/**
 * Select the best stream for a media type.
 */
export function selectStream(
  streams: Stream[],
  preference: StreamPreference,
): Stream {
  const filtered = streams.filter((s) => s.type === preference.type);
  assertNotVoid(filtered[0], `No streams for ${preference.type}`);

  if (preference.type === MediaType.VIDEO) {
    return matchVideoPreference(
      filtered as ByType<Stream, MediaType.VIDEO>[],
      preference,
    );
  }
  if (preference.type === MediaType.AUDIO) {
    return matchAudioPreference(
      filtered as ByType<Stream, MediaType.AUDIO>[],
      preference,
    );
  }

  throw new Error("Could not lookup preference type");
}

/**
 * Resolve a stream to a concrete track in a presentation.
 */
export function resolveTrack(
  presentation: Presentation,
  stream: Stream,
): Track {
  for (const switchingSet of presentation.switchingSets) {
    if (
      switchingSet.type !== stream.type ||
      switchingSet.codec !== stream.codec
    ) {
      continue;
    }
    for (const track of switchingSet.tracks) {
      if (isSameStream(stream, trackToStream(track, switchingSet.codec))) {
        return track;
      }
    }
  }

  throw new Error("No track found for stream in presentation");
}

type StreamAction = "switch" | "changeType" | null;

/**
 * Determine the action needed when changing from one
 * stream to another. Returns null if the streams are
 * identical, "changeType" if the codec differs, or
 * "switch" for a same-codec quality change.
 */
export function getStreamAction(
  oldStream: Stream,
  newStream: Stream,
): StreamAction {
  if (isSameStream(oldStream, newStream)) {
    return null;
  }
  if (oldStream.codec !== newStream.codec) {
    return "changeType";
  }
  return "switch";
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

function trackToStream(track: Track, codec: string): Stream {
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

function matchVideoPreference(
  streams: ByType<Stream, MediaType.VIDEO>[],
  preference: ByType<StreamPreference, MediaType.VIDEO>,
): Stream {
  assertNotVoid(streams[0], "No video streams to match against");
  let best = streams[0];
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
  streams: ByType<Stream, MediaType.AUDIO>[],
  preference: ByType<StreamPreference, MediaType.AUDIO>,
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
