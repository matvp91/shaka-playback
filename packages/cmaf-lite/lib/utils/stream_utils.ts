import type { Manifest, SwitchingSet, Track } from "../types/manifest";
import type { Stream, StreamPreference } from "../types/media";
import { MediaType } from "../types/media";
import * as asserts from "./asserts";
import * as CodecUtils from "./codec_utils";

/**
 * Walk the manifest once and produce per-type lists of `Stream`,
 * each carrying a `hierarchy` back-reference to the manifest's own
 * `SwitchingSet` and `Track` objects.
 */
export function buildStreams(manifest: Manifest): Map<MediaType, Stream[]> {
  const result = new Map<MediaType, Stream[]>();
  for (const ss of manifest.switchingSets) {
    for (const track of ss.tracks) {
      const stream = projectStream(ss, track);
      const list = result.get(stream.type);
      if (!list) {
        result.set(stream.type, [stream]);
        continue;
      }
      if (!list.some((s) => isSameStream(s, stream))) {
        list.push(stream);
      }
    }
  }
  asserts.assert(result.size > 0, "No streams found");
  // Sorted by bandwidth ascending — index 0 is lowest quality.
  // Required for ABR rules to reason about the quality ladder.
  for (const streams of result.values()) {
    streams.sort((a, b) => a.bandwidth - b.bandwidth);
  }
  return result;
}

/**
 * Select the best stream from a pre-filtered per-type list.
 */
export function selectStream(
  streams: Stream[],
  preference: StreamPreference,
): Stream {
  if (preference.type === MediaType.VIDEO) {
    const matchedStreams = streams.filter(
      (stream) => stream.type === preference.type,
    );
    return matchVideoPreference(matchedStreams, preference);
  }
  if (preference.type === MediaType.AUDIO) {
    const matchedStreams = streams.filter(
      (stream) => stream.type === preference.type,
    );
    return matchAudioPreference(matchedStreams, preference);
  }

  throw new Error("Could not lookup preference type");
}

function projectStream(ss: SwitchingSet, track: Track): Stream {
  const codec = CodecUtils.getNormalizedCodec(ss.codec);
  if (track.type === MediaType.VIDEO && ss.type === MediaType.VIDEO) {
    return {
      type: track.type,
      codec,
      bandwidth: track.bandwidth,
      width: track.width,
      height: track.height,
      hierarchy: {
        switchingSet: ss,
        track,
      },
    };
  }
  if (track.type === MediaType.AUDIO && ss.type === MediaType.AUDIO) {
    return {
      type: track.type,
      codec,
      bandwidth: track.bandwidth,
      hierarchy: {
        switchingSet: ss,
        track,
      },
    };
  }
  throw new Error(`Failed to map track for type ${track.type}`);
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

function matchVideoPreference(
  streams: Stream<MediaType.VIDEO>[],
  preference: StreamPreference<MediaType.VIDEO>,
): Stream<MediaType.VIDEO> {
  asserts.assertExists(streams[0], "No video streams to match against");
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
    if (preference.bandwidth !== undefined) {
      dist += Math.abs(stream.bandwidth - preference.bandwidth);
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
  streams: Stream<MediaType.AUDIO>[],
  preference: StreamPreference<MediaType.AUDIO>,
): Stream<MediaType.AUDIO> {
  asserts.assertExists(streams[0], "No video streams to match against");
  let best = streams[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const stream of streams) {
    let dist = 0;
    if (preference.bandwidth !== undefined) {
      dist += Math.abs(stream.bandwidth - preference.bandwidth);
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
