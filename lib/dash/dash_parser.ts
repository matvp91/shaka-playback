import { XMLParser } from "fast-xml-parser";
import type {
  Manifest,
  Presentation,
  SelectionSet,
  SwitchingSet,
  Track,
} from "../types/manifest";
import { TrackType } from "../types/manifest";
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

type Options = {
  sourceUrl: string;
};

async function parseManifest(text: string, options: Options) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    isArray: (tagName) => DASH_ARRAY_NODES.includes(tagName),
  });
  const mpd = parser.parse(text).MPD as MPD;

  const manifest: Manifest = {
    presentations: mpd.Period.map((period) =>
      parsePeriod(options, mpd, period),
    ),
  };

  return manifest;
}

function parsePeriod(options: Options, mpd: MPD, period: Period): Presentation {
  const group = groupAdaptationSets(period.AdaptationSet);
  const adaptationSetSets = Array.from(group.values());

  const index = mpd.Period.indexOf(period);
  const nextPeriod = mpd.Period[index + 1];
  const start = period["@_start"] ? parseDuration(period["@_start"]) : 0;
  const duration =
    nextPeriod?.["@_start"] ?? mpd["@_mediaPresentationDuration"];
  const end = duration ? parseDuration(duration) : start;

  return {
    start,
    end,
    selectionSets: adaptationSetSets.map((adaptationSets) =>
      parseAdaptationSets(options, mpd, period, adaptationSets),
    ),
  };
}

function parseAdaptationSets(
  options: Options,
  mpd: MPD,
  period: Period,
  adaptationSets: AdaptationSet[],
): SelectionSet {
  const switchingSets = adaptationSets.map((adaptationSet) =>
    parseAdaptationSet(options, mpd, period, adaptationSet),
  );
  // Store type of convenience, we don't have to dig down every
  // time we need a track type.
  const type = switchingSets[0]?.tracks[0]?.type;
  assertNotVoid(type, "type is mandatory");

  return {
    type,
    switchingSets,
  };
}

function parseAdaptationSet(
  options: Options,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
): SwitchingSet {
  return {
    tracks: adaptationSet.Representation.map((representation) =>
      parseRepresentation(options, mpd, period, adaptationSet, representation),
    ),
  };
}

function parseRepresentation(
  options: Options,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
): Track {
  const baseUrls = filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = resolveUrls([options.sourceUrl, ...baseUrls]);

  // Common properties
  const mimeType = findMap([representation, adaptationSet], "@_mimeType");
  assertNotVoid(mimeType, "mimeType is mandatory");

  const codec = findMap([representation, adaptationSet], "@_codecs");
  assertNotVoid(codec, "codecs is mandatory");

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
      type: TrackType.VIDEO,
      mimeType,
      codec,
      width,
      height,
      bandwidth,
      ...segmentData,
    };
  }

  if (mimeType.startsWith("audio/")) {
    return {
      type: TrackType.AUDIO,
      mimeType,
      codec,
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
