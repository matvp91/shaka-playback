import type { Manifest, SwitchingSet, Track } from "../types/manifest";
import type { Preference, Stream } from "../types/media";
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
 * Return the match set for the highest-priority preference that
 * yields at least one matching stream. Returns `null` if no
 * preference matches. Does not perform quality selection — callers
 * combine this with `pickClosestByBandwidth` or similar when more
 * than one stream matches.
 */
export function findStreamsMatchingPreferences<T extends MediaType>(
  type: T,
  streams: Stream<T>[],
  preferences: Preference[],
): Stream<T>[] | null {
  asserts.assertExists(streams[0], "No Streams");

  for (const preference of preferences) {
    if (preference.type !== type) {
      continue;
    }
    const normalizedCodec =
      preference.codec !== undefined
        ? CodecUtils.getNormalizedCodec(preference.codec)
        : undefined;
    const matches = streams.filter((s) =>
      matchesPreference(s, preference, normalizedCodec),
    );
    if (matches.length === 0) {
      continue;
    }
    return matches;
  }

  return null;
}

function matchesPreference(
  stream: Stream,
  _preference: Preference,
  normalizedCodec: string | undefined,
): boolean {
  if (normalizedCodec !== undefined) {
    if (stream.codec !== normalizedCodec) {
      return false;
    }
  }
  // TODO(matvp): language/channels matching once those fields
  // are added to AudioStream/SubtitleStream.
  return true;
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
