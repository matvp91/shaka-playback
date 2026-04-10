import { decodeIso8601Duration } from "@svta/cml-iso-8601";
import { XMLParser } from "fast-xml-parser";
import type { Manifest, SwitchingSet, Track } from "../types/manifest";
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

  const switchingSets = flattenPeriods(sourceUrl, mpd);
  const duration = resolveDuration(mpd, switchingSets);

  const manifest: Manifest = {
    duration,
    switchingSets,
  };
  return manifest;
}

function flattenPeriods(sourceUrl: string, mpd: MPD): SwitchingSet[] {
  const result: SwitchingSet[] = [];

  for (let i = 0; i < mpd.Period.length; i++) {
    const period = mpd.Period[i];
    asserts.assertExists(period, "Period is undefined");
    const duration = resolvePeriodDuration(mpd, period, i);

    for (const as of period.AdaptationSet) {
      const type = inferMediaType(as);
      asserts.assertExists(type, "Cannot infer media type");
      const ss = parseSwitchingSet(sourceUrl, mpd, period, as, type, duration);

      const existing = result.find(
        (r) => r.type === ss.type && r.codec === ss.codec,
      );

      if (existing) {
        for (let t = 0; t < ss.tracks.length; t++) {
          asserts.assertExists(
            existing.tracks[t],
            "Track count mismatch across periods",
          );
          asserts.assertExists(
            ss.tracks[t],
            "Track count mismatch across periods",
          );
          // biome-ignore lint/style/noNonNullAssertion: asserted above
          existing.tracks[t]!.segments.push(...ss.tracks[t]!.segments);
        }
      } else {
        result.push(ss);
      }
    }
  }

  return result;
}

function resolveDuration(mpd: MPD, switchingSets: SwitchingSet[]): number {
  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return decodeIso8601Duration(mpdDuration);
  }

  const lastSegmentEnd = switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  asserts.assertExists(lastSegmentEnd, "Cannot resolve duration");
  return lastSegmentEnd;
}

/**
 * Resolve the period's duration from manifest metadata only.
 * Runs before segment parsing so duration-based segment
 * generation has the information it needs. Returns null when
 * metadata alone cannot determine the duration — callers must
 * fall back to parsed segment data instead.
 */
function resolvePeriodDuration(
  mpd: MPD,
  period: Period,
  periodIndex: number,
): number | null {
  const duration = period["@_duration"];
  if (duration != null) {
    return decodeIso8601Duration(duration);
  }

  const start = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

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

  const { segments } = parseSegmentData(
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
      segments,
    };
  }

  if (type === MediaType.AUDIO) {
    return {
      type: MediaType.AUDIO,
      bandwidth,
      segments,
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
