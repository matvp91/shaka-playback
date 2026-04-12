import type { ByType, Stream } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import prettyBytes from "pretty-bytes";

type GroupedStreams = {
  video: ByType<Stream, MediaType.VIDEO>[];
  audio: ByType<Stream, MediaType.AUDIO>[];
};

/**
 * Groups streams by media type.
 */
export function groupByType(streams: Stream[]): GroupedStreams {
  const video: ByType<Stream, MediaType.VIDEO>[] = [];
  const audio: ByType<Stream, MediaType.AUDIO>[] = [];

  for (const stream of streams) {
    if (stream.type === MediaType.VIDEO) {
      video.push(stream);
    } else if (stream.type === MediaType.AUDIO) {
      audio.push(stream);
    }
  }

  return { video, audio };
}

/**
 * Formats bandwidth as a human-readable string.
 */
export function formatBandwidth(bps: number): string {
  return `${prettyBytes(bps, { bits: true })}/s`;
}

/**
 * Formats a stream as a human-readable label.
 * Used as display text and as select value/React key.
 */
export function formatStream(stream: Stream): string {
  if (stream.type === MediaType.VIDEO) {
    return `${stream.width}x${stream.height} · ${formatBandwidth(stream.bandwidth)} · ${stream.codec}`;
  }
  return `${formatBandwidth(stream.bandwidth)} · ${stream.codec}`;
}
