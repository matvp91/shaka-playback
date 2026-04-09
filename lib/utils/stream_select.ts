import type {
  Manifest,
  Presentation,
  Stream,
  StreamPreference,
  Track,
} from "../types";
import { MediaType } from "../types";
import { assert, assertNotVoid } from "./assert";

export type StreamAction = "switch" | "changeType";

export type StreamSelection = {
  stream: Stream;
  action: StreamAction | null;
};

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
 * Select the best stream for a media type. Compares to
 * the current stream (if any) to determine the action
 * needed (switch or changeType, null if unchanged).
 */
export function selectStream(
  streams: Stream[],
  type: MediaType,
  current?: Stream,
  preference?: StreamPreference,
): StreamSelection {
  const filtered = streams.filter(
    (s): s is Stream & { type: typeof type } => s.type === type,
  );
  assertNotVoid(filtered[0], `No streams for ${type}`);

  let stream: Stream;
  if (!preference) {
    stream = filtered[0];
  } else if (preference.type === MediaType.VIDEO) {
    stream = matchVideoPreference(
      filtered as (Stream & { type: MediaType.VIDEO })[],
      preference,
    );
  } else {
    stream = matchAudioPreference(
      filtered as (Stream & { type: MediaType.AUDIO })[],
      preference,
    );
  }

  if (!current || isSameStream(current, stream)) {
    return { stream, action: null };
  }
  if (current.codec !== stream.codec) {
    return { stream, action: "changeType" };
  }
  return { stream, action: "switch" };
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
  streams: (Stream & { type: MediaType.VIDEO })[],
  preference: {
    type: MediaType.VIDEO;
    codec?: string;
    width?: number;
    height?: number;
  },
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
  streams: (Stream & { type: MediaType.AUDIO })[],
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
