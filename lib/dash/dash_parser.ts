import { XMLParser } from "fast-xml-parser";
import type {
  Manifest,
  Presentation,
  SelectionSet,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { MediaType } from "../types/manifest";
import { assertNotVoid, assertNumber } from "../utils/assert";
import { filterMap, findMap } from "../utils/functional";
import { parseDuration } from "../utils/time";
import { resolveUrls } from "../utils/url";
import { parseSegmentData } from "./dash_presentation";
import type { AdaptationSet, MPD, Period, Representation } from "./types";

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

export async function fetchManifest(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return parseManifest(text, {
    sourceUrl: url,
  });
}

type ParseManifestOptions = {
  sourceUrl: string;
};

async function parseManifest(text: string, options: ParseManifestOptions) {
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
    parsePeriod(options, mpd, period, periodIndex),
  );

  const manifest: Manifest = { presentations };

  return manifest;
}

function parsePeriod(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  periodIndex: number,
): Presentation {
  const start = period["@_start"] ? parseDuration(period["@_start"]) : 0;

  const grouped = groupAdaptationSets(period.AdaptationSet);

  const selectionSets: SelectionSet[] = Array.from(grouped.entries()).map(
    ([_key, adaptationSets]) =>
      parseSelectionSet(options, mpd, period, adaptationSets),
  );

  const end = resolvePresentationEnd(
    mpd,
    period,
    periodIndex,
    start,
    selectionSets,
  );

  return { start, end, selectionSets };
}

/**
 * Resolve presentation end time using the
 * DASH spec fallback chain:
 * 1. Period@duration
 * 2. Next Period@start
 * 3. MPD@mediaPresentationDuration
 * 4. Last segment end (robustness fallback)
 */
function resolvePresentationEnd(
  mpd: MPD,
  period: Period,
  periodIndex: number,
  start: number,
  selectionSets: SelectionSet[],
): number {
  const duration = period["@_duration"];
  if (duration != null) {
    return start + parseDuration(duration);
  }

  const nextStart = mpd.Period[periodIndex + 1]?.["@_start"];
  if (nextStart != null) {
    return parseDuration(nextStart);
  }

  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return parseDuration(mpdDuration);
  }

  const lastSegmentEnd =
    selectionSets[0]?.switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  assertNotVoid(lastSegmentEnd, "Cannot resolve presentation end");
  return lastSegmentEnd;
}

function parseSelectionSet(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSets: AdaptationSet[],
): SelectionSet {
  const first = adaptationSets[0];
  assertNotVoid(first, "No AdaptationSet found");
  const type = inferMediaType(first);
  assertNotVoid(type, "Cannot infer media type");

  const switchingSets = adaptationSets.map((as) =>
    parseSwitchingSet(options, mpd, period, as, type),
  );

  return { type, switchingSets };
}

function parseSwitchingSet(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  type: MediaType,
): SwitchingSet {
  const firstRep = adaptationSet.Representation[0];
  assertNotVoid(firstRep, "No Representation found");

  const mimeType = findMap([firstRep, adaptationSet], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const codec = findMap([firstRep, adaptationSet], "@_codecs");
  assertNotVoid(codec, "codecs is mandatory");

  const tracks = adaptationSet.Representation.map((rep) =>
    parseTrack(options, mpd, period, adaptationSet, rep, type),
  );

  return { mimeType, codec, tracks };
}

function parseTrack(
  options: ParseManifestOptions,
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
  const baseUrl = resolveUrls([options.sourceUrl, ...baseUrls]);

  const bandwidth = Number(representation["@_bandwidth"]);
  assertNumber(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
  );

  if (type === MediaType.VIDEO) {
    const width = Number(findMap([representation, adaptationSet], "@_width"));
    assertNumber(width, "width is mandatory");

    const height = Number(findMap([representation, adaptationSet], "@_height"));
    assertNumber(height, "height is mandatory");

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

/**
 * Group AdaptationSets by @group or inferred
 * content type. Each group becomes a SelectionSet,
 * each AdaptationSet within becomes a SwitchingSet.
 */
function groupAdaptationSets(adaptationSets: AdaptationSet[]) {
  const groups = new Map<string, AdaptationSet[]>();
  for (const adaptationSet of adaptationSets) {
    const key = adaptationSet["@_group"] ?? inferContentType(adaptationSet);
    const list = groups.get(key) ?? [];
    list.push(adaptationSet);
    groups.set(key, list);
  }
  return groups;
}

function inferContentType(adaptationSet: AdaptationSet) {
  if (adaptationSet["@_contentType"]) {
    return adaptationSet["@_contentType"];
  }
  const mimeType =
    adaptationSet["@_mimeType"] ??
    adaptationSet.Representation[0]?.["@_mimeType"];
  if (mimeType) {
    const type = mimeType.split("/")[0] ?? mimeType;
    return type === "application" ? "text" : type;
  }
  return "unknown";
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
