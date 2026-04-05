import { XMLParser } from "fast-xml-parser";
import type {
  Manifest,
  Presentation,
  SelectionSet,
  SwitchingSet,
  Track,
} from "../types";
import { filterMap } from "../utils/functional";
import { resolveUrls } from "../utils/url";
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

  return {
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
  return {
    switchingSets: adaptationSets.map((adaptationSet) =>
      parseAdaptationSet(options, mpd, period, adaptationSet),
    ),
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
  console.log(baseUrl);

  return {} as unknown as Track;
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
