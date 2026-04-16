import type * as txml from "txml";
import type { SwitchingSet, Track } from "../types/manifest";
import { MediaType } from "../types/media";
import * as asserts from "../utils/asserts";
import * as Functional from "../utils/functional";
import * as ManifestUtils from "../utils/manifest_utils";
import * as UrlUtils from "../utils/url_utils";
import * as XmlUtils from "../utils/xml_utils";
import { parseSegmentData } from "./dash_segments";

type PeriodContext = {
  sourceUrl: string;
  mpd: txml.TNode;
  switchingSets: Map<string, SwitchingSet>;
  tracks: Map<string, Track>;
};

export function flattenPeriods(
  sourceUrl: string,
  mpd: txml.TNode,
  periods: txml.TNode[],
): SwitchingSet[] {
  const ctx: PeriodContext = {
    sourceUrl,
    mpd,
    switchingSets: new Map(),
    tracks: new Map(),
  };

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    asserts.assertExists(period, "Period not found");
    const duration = resolvePeriodDuration(mpd, periods, i);
    for (const adaptationSet of XmlUtils.children(period, "AdaptationSet")) {
      processAdaptationSet(ctx, period, adaptationSet, duration);
    }
  }

  return [...ctx.switchingSets.values()];
}

function processAdaptationSet(
  ctx: PeriodContext,
  period: txml.TNode,
  adaptationSet: txml.TNode,
  duration: number | null,
): void {
  const representations = XmlUtils.children(adaptationSet, "Representation");
  if (representations.length === 0) {
    return;
  }

  const type = inferMediaType(adaptationSet, representations);
  const codec = resolveCodec(adaptationSet, representations);
  const switchingSetKey = ManifestUtils.getSwitchingSetKey(type, codec);
  const switchingSet = getOrCreateSwitchingSet(
    ctx,
    switchingSetKey,
    type,
    codec,
  );

  for (const representation of representations) {
    const id = XmlUtils.attr(representation, "id", XmlUtils.parseString);
    asserts.assertExists(id, "Representation@id is mandatory");

    const track = parseTrack(
      ctx,
      period,
      adaptationSet,
      representation,
      type,
      duration,
    );
    const trackKey = `${switchingSetKey}:${id}`;
    addTrack(ctx, switchingSet, trackKey, track);
  }
}

function getOrCreateSwitchingSet(
  ctx: PeriodContext,
  key: string,
  type: MediaType,
  codec: string,
): SwitchingSet {
  const switchingSet = ctx.switchingSets.get(key);
  if (switchingSet) {
    return switchingSet;
  }
  const newSwitchingSet: SwitchingSet = {
    type,
    codec,
    tracks: [],
  };
  ctx.switchingSets.set(key, newSwitchingSet);
  return newSwitchingSet;
}

function addTrack(
  ctx: PeriodContext,
  switchingSet: SwitchingSet,
  trackKey: string,
  track: Track,
): void {
  const existingTrack = ctx.tracks.get(trackKey);
  if (existingTrack) {
    existingTrack.segments.push(...track.segments);
  } else {
    ctx.tracks.set(trackKey, track);
    if (switchingSet.type === track.type) {
      // Allow type cast, TS is not able to infer the
      // type equality but we conditionally check it anyways.
      (switchingSet.tracks as Track[]).push(track);
    }
  }
}

function resolvePeriodDuration(
  mpd: txml.TNode,
  periods: txml.TNode[],
  periodIndex: number,
): number | null {
  const period = periods[periodIndex];
  asserts.assertExists(period, "Period not found");

  const duration = XmlUtils.attr(period, "duration", XmlUtils.parseDuration);
  if (duration != null) {
    return duration;
  }

  const start = XmlUtils.attr(period, "start", XmlUtils.parseDuration) ?? 0;

  const nextPeriod = periods[periodIndex + 1];
  const nextStart = nextPeriod
    ? XmlUtils.attr(nextPeriod, "start", XmlUtils.parseDuration)
    : undefined;
  if (nextStart != null) {
    return nextStart - start;
  }

  const mpdDuration = XmlUtils.attr(
    mpd,
    "mediaPresentationDuration",
    XmlUtils.parseDuration,
  );
  if (mpdDuration != null) {
    return mpdDuration - start;
  }

  return null;
}

function parseTrack(
  ctx: PeriodContext,
  period: txml.TNode,
  adaptationSet: txml.TNode,
  representation: txml.TNode,
  type: MediaType,
  duration: number | null,
): Track {
  const baseUrls = [ctx.mpd, period, adaptationSet, representation].flatMap(
    (node) => XmlUtils.children(node, "BaseURL").map(XmlUtils.text),
  );
  const baseUrl = UrlUtils.resolveUrls([
    ctx.sourceUrl,
    ...baseUrls.filter((u): u is string => u != null),
  ]);

  const bandwidth = XmlUtils.attr(
    representation,
    "bandwidth",
    XmlUtils.parseNumber,
  );
  asserts.assertExists(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    period,
    adaptationSet,
    representation,
    baseUrl,
    bandwidth,
    duration,
  );

  if (type === MediaType.VIDEO) {
    const width = Functional.findMap([representation, adaptationSet], (n) =>
      XmlUtils.attr(n, "width", XmlUtils.parseNumber),
    );
    asserts.assertExists(width, "width is mandatory");

    const height = Functional.findMap([representation, adaptationSet], (n) =>
      XmlUtils.attr(n, "height", XmlUtils.parseNumber),
    );
    asserts.assertExists(height, "height is mandatory");

    return {
      type: MediaType.VIDEO,
      width,
      height,
      bandwidth,
      ...segmentData,
    };
  }

  if (type === MediaType.AUDIO) {
    return {
      type: MediaType.AUDIO,
      bandwidth,
      ...segmentData,
    };
  }

  throw new Error("TODO: Map TEXT type");
}

function inferMediaType(
  adaptationSet: txml.TNode,
  representations: txml.TNode[],
): MediaType {
  const contentType = XmlUtils.attr(
    adaptationSet,
    "contentType",
    XmlUtils.parseString,
  );
  if (contentType === "video") {
    return MediaType.VIDEO;
  }
  if (contentType === "audio") {
    return MediaType.AUDIO;
  }
  if (contentType === "text") {
    return MediaType.TEXT;
  }
  const mimeType =
    XmlUtils.attr(adaptationSet, "mimeType", XmlUtils.parseString) ??
    (representations[0]
      ? XmlUtils.attr(representations[0], "mimeType", XmlUtils.parseString)
      : undefined);
  if (mimeType?.startsWith("video/")) {
    return MediaType.VIDEO;
  }
  if (mimeType?.startsWith("audio/")) {
    return MediaType.AUDIO;
  }
  if (mimeType?.startsWith("text/") || mimeType?.startsWith("application/")) {
    return MediaType.TEXT;
  }
  throw new Error("Failed to infer media type");
}

function resolveCodec(
  adaptationSet: txml.TNode,
  representations: txml.TNode[],
): string {
  const firstRep = representations[0];
  asserts.assertExists(firstRep, "No Representation found");

  const codec = Functional.findMap([firstRep, adaptationSet], (n) =>
    XmlUtils.attr(n, "codecs", XmlUtils.parseString),
  );
  asserts.assertExists(codec, "codecs is mandatory");

  return codec;
}
