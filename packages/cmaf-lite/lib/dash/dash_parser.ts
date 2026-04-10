import { decodeIso8601Duration } from "@svta/cml-iso-8601";
import { XMLParser } from "fast-xml-parser";
import type {
  Manifest,
  Presentation,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { MediaType } from "../types/media";
import * as asserts from "../utils/asserts";
import * as Functional from "../utils/functional";
import * as UrlUtils from "../utils/url_utils";
import * as XmlUtils from "../utils/xml_utils";
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

  const lastPresentation = presentations.at(-1);
  asserts.assertExists(lastPresentation, "No Presentation");

  const manifest: Manifest = {
    duration: lastPresentation.end,
    presentations,
  };
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

  const duration = resolvePresentationDuration(mpd, period, periodIndex, start);

  const switchingSets = period.AdaptationSet.map((as) => {
    const type = inferMediaType(as);
    asserts.assertExists(type, "Cannot infer media type");
    return parseSwitchingSet(sourceUrl, mpd, period, as, type, duration);
  });

  const end = resolvePresentationEnd(duration, start, switchingSets);

  return { start, end, switchingSets };
}

/**
 * Resolve the period's duration from manifest metadata only.
 * Runs before segment parsing so duration-based segment
 * generation has the information it needs. Returns null when
 * metadata alone cannot determine the duration — callers must
 * fall back to parsed segment data instead.
 */
function resolvePresentationDuration(
  mpd: MPD,
  period: Period,
  periodIndex: number,
  start: number,
): number | null {
  const duration = period["@_duration"];
  if (duration != null) {
    return decodeIso8601Duration(duration);
  }

  const nextStart = mpd.Period[periodIndex + 1]?.["@_start"];
  if (nextStart != null) {
    return decodeIso8601Duration(nextStart) - start;
  }

  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return decodeIso8601Duration(mpdDuration) - start;
  }

  return null;
}

/**
 * Resolve the absolute end time for the Presentation. Unlike
 * resolvePresentationDuration, this runs after segment parsing
 * and can use segment data as a last resort when metadata is
 * incomplete (only valid for explicit addressing).
 */
function resolvePresentationEnd(
  duration: number | null,
  start: number,
  switchingSets: SwitchingSet[],
): number {
  if (duration != null) {
    return start + duration;
  }

  const lastSegmentEnd = switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  asserts.assertExists(lastSegmentEnd, "Cannot resolve presentation end");
  return lastSegmentEnd;
}

function parseSwitchingSet(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  type: MediaType,
  duration: number | null,
): SwitchingSet {
  const firstRep = adaptationSet.Representation[0];
  asserts.assertExists(firstRep, "No Representation found");

  const codec = Functional.findMap([firstRep, adaptationSet], (node) =>
    node["@_codecs"]?.toLowerCase(),
  );
  asserts.assertExists(codec, "codecs is mandatory");

  const tracks = adaptationSet.Representation.map((rep) =>
    parseTrack(sourceUrl, mpd, period, adaptationSet, rep, type, duration),
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
  duration: number | null,
): Track {
  const baseUrls = Functional.filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = UrlUtils.resolveUrls([sourceUrl, ...baseUrls]);

  const bandwidth = XmlUtils.asNumber(representation["@_bandwidth"]);
  asserts.assertExists(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
    duration,
  );

  if (type === MediaType.VIDEO) {
    const width = XmlUtils.asNumber(
      Functional.findMap([representation, adaptationSet], "@_width"),
    );
    asserts.assertExists(width, "width is mandatory");

    const height = XmlUtils.asNumber(
      Functional.findMap([representation, adaptationSet], "@_height"),
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
