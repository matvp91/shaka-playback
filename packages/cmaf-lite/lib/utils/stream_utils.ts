import type { Manifest, SwitchingSet, Track } from "../types/manifest";
import type { ByType, Stream, StreamPreference } from "../types/media";
import { MediaType } from "../types/media";
import * as asserts from "./asserts";
import * as CodecUtils from "./codec_utils";

/**
 * Derive the set of available streams from the manifest.
 */
export function getStreams(manifest: Manifest): Stream[] {
  const streams: Stream[] = [];
  for (const ss of manifest.switchingSets) {
    for (const track of ss.tracks) {
      const stream: Stream =
        track.type === MediaType.VIDEO
          ? {
              type: track.type,
              codec: CodecUtils.getNormalizedCodec(ss.codec),
              width: track.width,
              height: track.height,
            }
          : {
              type: track.type,
              codec: CodecUtils.getNormalizedCodec(ss.codec),
            };
      if (!streams.some((s) => isSameStream(s, stream))) {
        streams.push(stream);
      }
    }
  }
  asserts.assert(streams.length > 0, "No streams found");
  return streams;
}

/**
 * Select the best stream for a media type.
 */
export function selectStream(
  streams: Stream[],
  preference: StreamPreference,
): Stream {
  const filtered = streams.filter((s) => s.type === preference.type);
  asserts.assertExists(filtered[0], `No streams for ${preference.type}`);

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
  streams: ByType<Stream, MediaType.VIDEO>[],
  preference: ByType<StreamPreference, MediaType.VIDEO>,
): Stream {
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
  asserts.assertExists(streams[0], "No audio streams to match against");
  return streams[0];
}

/**
 * Find the SwitchingSet and Track matching a stream.
 */
export function resolveHierarchy(
  manifest: Manifest,
  stream: Stream,
): [SwitchingSet, Track] {
  for (const switchingSet of manifest.switchingSets) {
    if (
      switchingSet.type !== stream.type ||
      CodecUtils.getNormalizedCodec(switchingSet.codec) !== stream.codec
    ) {
      continue;
    }
    for (const track of switchingSet.tracks) {
      if (
        stream.type !== MediaType.VIDEO ||
        track.type !== MediaType.VIDEO ||
        (stream.width === track.width && stream.height === track.height)
      ) {
        return [switchingSet, track];
      }
    }
  }
  throw new Error("No matching hierarchy for stream");
}
