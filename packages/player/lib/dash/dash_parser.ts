import { decodeIso8601Duration } from "@svta/cml-iso-8601";
import { XMLParser } from "fast-xml-parser";
import type {
  Manifest,
  Presentation,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { MediaType } from "../types/media";
import { assertNotVoid } from "../utils/assert";
import { filterMap, findMap } from "../utils/functional";
import { asNumber } from "../utils/parse";
import { resolveUrls } from "../utils/url";
import { parseSegmentData } from "./dash_presentation";
import type { AdaptationSet, MPD, Period, Representation } from "./dash_types";

const DASH_ARRAY_NODES = [
  "Period",
  "AdaptationSet",
  "Representation",
  "S",
  "AudioChannelConfiguration",
  "SupplementalProperty",
  "EssentialProperty",
  "ContentProtection",
  "Role",
  "Accessibility",
  "SegmentURL",
  "EventStream",
  "Event",
];

export function parseManifest(text: string, sourceUrl: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    isArray: (tagName) => DASH_ARRAY_NODES.includes(tagName),
  });
  const mpd = parser.parse(text).MPD as MPD;

  if (mpd.Period.length === 0) {
    throw new Error("No Period found in manifest");
  }

  const presentations = mpd.Period.map((period, periodIndex) =>
    parsePeriod(sourceUrl, mpd, period, periodIndex),
  );

  const manifest: Manifest = { presentations };

  return manifest;
}

function parsePeriod(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  periodIndex: number,
): Presentation {
  const start = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const switchingSets = period.AdaptationSet.map((as) => {
    const type = inferMediaType(as);
    assertNotVoid(type, "Cannot infer media type");
    return parseSwitchingSet(sourceUrl, mpd, period, as, type);
  });

  const end = resolvePresentationEnd(
    mpd,
    period,
    periodIndex,
    start,
    switchingSets,
  );

  return { start, end, switchingSets };
}

/**
 * Resolve presentation end using the DASH fallback chain:
 * duration → next start → MPD duration → last segment end.
 */
function resolvePresentationEnd(
  mpd: MPD,
  period: Period,
  periodIndex: number,
  start: number,
  switchingSets: SwitchingSet[],
): number {
  const duration = period["@_duration"];
  if (duration != null) {
    return start + decodeIso8601Duration(duration);
  }

  const nextStart = mpd.Period[periodIndex + 1]?.["@_start"];
  if (nextStart != null) {
    return decodeIso8601Duration(nextStart);
  }

  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return decodeIso8601Duration(mpdDuration);
  }

  const lastSegmentEnd = switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  assertNotVoid(lastSegmentEnd, "Cannot resolve presentation end");
  return lastSegmentEnd;
}

function parseSwitchingSet(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  type: MediaType,
): SwitchingSet {
  const firstRep = adaptationSet.Representation[0];
  assertNotVoid(firstRep, "No Representation found");

  const codec = findMap([firstRep, adaptationSet], (node) =>
    node["@_codecs"]?.toLowerCase(),
  );
  assertNotVoid(codec, "codecs is mandatory");

  const tracks = adaptationSet.Representation.map((rep) =>
    parseTrack(sourceUrl, mpd, period, adaptationSet, rep, type),
  );

  return { type, codec, tracks };
}

function parseTrack(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  type: MediaType,
): Track {
  const baseUrls = filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = resolveUrls([sourceUrl, ...baseUrls]);

  const bandwidth = asNumber(representation["@_bandwidth"]);
  assertNotVoid(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
  );

  if (type === MediaType.VIDEO) {
    const width = asNumber(findMap([representation, adaptationSet], "@_width"));
    assertNotVoid(width, "width is mandatory");

    const height = asNumber(
      findMap([representation, adaptationSet], "@_height"),
    );
    assertNotVoid(height, "height is mandatory");

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

function inferMediaType(adaptationSet: AdaptationSet): MediaType | null {
  const contentType = adaptationSet["@_contentType"];
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
    adaptationSet["@_mimeType"] ??
    adaptationSet.Representation[0]?.["@_mimeType"];
  if (mimeType?.startsWith("video/")) {
    return MediaType.VIDEO;
  }
  if (mimeType?.startsWith("audio/")) {
    return MediaType.AUDIO;
  }
  if (mimeType?.startsWith("text/") || mimeType?.startsWith("application/")) {
    return MediaType.TEXT;
  }
  return null;
}
