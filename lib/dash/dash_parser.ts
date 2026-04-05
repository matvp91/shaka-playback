import { XMLParser } from "fast-xml-parser";
import type { Manifest, Presentation } from "../types";
import type { MPD, Period } from "./types";

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
  return {
    selectionSets: [],
  };
}
