import { XMLParser } from "fast-xml-parser";
import type { Manifest, MediaGroup, Stream } from "../types/manifest";
import { MediaType } from "../types/manifest";
import { assertNotVoid, assertNumber } from "../utils/assert";
import { filterMap, findMap } from "../utils/functional";
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

  const period = mpd.Period[0];
  if (!period) {
    throw new Error("No Period found in manifest");
  }

  const manifest: Manifest = {
    groups: parsePeriod(options, mpd, period),
  };

  return manifest;
}

function parsePeriod(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
): MediaGroup[] {
  const grouped = groupAdaptationSets(period.AdaptationSet);
  const adaptationSetSets = Array.from(grouped.values());

  return adaptationSetSets.map((adaptationSets) =>
    parseAdaptationSets(options, mpd, period, adaptationSets),
  );
}

function parseAdaptationSets(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSets: AdaptationSet[],
): MediaGroup {
  const streams = adaptationSets.flatMap((adaptationSet) =>
    parseAdaptationSet(options, mpd, period, adaptationSet),
  );

  const first = streams[0];
  assertNotVoid(first, "No streams found");

  const as = adaptationSets[0];
  assertNotVoid(as, "No AdaptationSet found");
  const rep = as.Representation[0];
  assertNotVoid(rep, "No Representation found");

  const mimeType = findMap([rep, as], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const codec = findMap([rep, as], "@_codecs");
  assertNotVoid(codec, "codecs is mandatory");

  return {
    type: first.type,
    mimeType,
    codec,
    streams,
  };
}

function parseAdaptationSet(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
): Stream[] {
  return adaptationSet.Representation.map((representation) =>
    parseRepresentation(options, mpd, period, adaptationSet, representation),
  );
}

function parseRepresentation(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
): Stream {
  const baseUrls = filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = resolveUrls([options.sourceUrl, ...baseUrls]);

  const mimeType = findMap([representation, adaptationSet], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const bandwidth = Number(representation["@_bandwidth"]);
  assertNumber(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
  );

  if (mimeType.startsWith("video/")) {
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

  if (mimeType.startsWith("audio/")) {
    return {
      type: MediaType.AUDIO,
      bandwidth,
      ...segmentData,
    };
  }

  throw new Error("TODO: Map TEXT type");
}

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
