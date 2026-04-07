import type { InitSegment, Segment } from "../types/manifest";
import { assertNotVoid, assertNumber } from "../utils/assert";
import { findMap } from "../utils/functional";
import { resolveUrl } from "../utils/url";
import type {
  AdaptationSet,
  MPD,
  Period,
  Representation,
  SegmentTemplate,
  SegmentTimeline,
} from "./types";

export function parseSegmentData(
  _mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  baseUrl: string,
) {
  const st = resolveSegmentTemplate(
    period.SegmentTemplate,
    adaptationSet.SegmentTemplate,
    representation.SegmentTemplate,
  );

  const timeline = st.SegmentTimeline;
  assertNotVoid(timeline, "SegmentTimeline is mandatory");

  const initialization = st["@_initialization"];
  assertNotVoid(initialization, "initialization is mandatory");

  const media = st["@_media"];
  assertNotVoid(media, "media is mandatory");

  const timescale = Number(st["@_timescale"]);
  assertNumber(timescale, "timescale is mandatory");

  const presentationTimeOffset = Number(st["@_presentationTimeOffset"] ?? 0);
  const timeOffset = presentationTimeOffset / timescale;

  const initSegmentUrl = resolveUrl(
    applyUrlTemplate(initialization, {
      RepresentationID: representation["@_id"],
      Bandwidth: representation["@_bandwidth"],
    }),
    baseUrl,
  );

  const segments = mapTemplateTimeline(
    timeline,
    media,
    st,
    representation,
    baseUrl,
  );

  return {
    timeOffset,
    initSegment: { url: initSegmentUrl } satisfies InitSegment,
    segments,
  };
}

function mapTemplateTimeline(
  timeline: SegmentTimeline,
  media: string,
  st: SegmentTemplate,
  representation: Representation,
  baseUrl: string,
): Segment[] {
  const timescale = Number(st["@_timescale"] ?? 1);
  const startNumber = Number(st["@_startNumber"] ?? 1);
  const segments: Segment[] = [];
  let time = 0;
  let number = startNumber;

  for (const s of timeline.S) {
    const d = Number(s["@_d"]);
    const r = Number(s["@_r"] ?? 0);

    if (s["@_t"] != null) {
      time = Number(s["@_t"]);
    }

    for (let i = 0; i <= r; i++) {
      const relativeUrl = applyUrlTemplate(media, {
        RepresentationID: representation["@_id"],
        Bandwidth: representation["@_bandwidth"],
        Number: number,
        Time: time,
      });
      const url = resolveUrl(relativeUrl, baseUrl);
      segments.push({
        url,
        start: time / timescale,
        end: (time + d) / timescale,
      });
      time += d;
      number++;
    }
  }

  return segments;
}

function applyUrlTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\$(\w+)(?:%0(\d+)d)?\$/g, (match, key, width) => {
    const value = vars[key];
    if (value == null) {
      return match;
    }
    const str = String(value);
    return width ? str.padStart(Number(width), "0") : str;
  });
}

function resolveSegmentTemplate(
  periodSt?: SegmentTemplate,
  asSt?: SegmentTemplate,
  repSt?: SegmentTemplate,
): SegmentTemplate {
  if (!periodSt && !asSt && !repSt) {
    throw new Error("We've got to have some sort of templating");
  }

  // Child wins - rep overrides as overrides period
  const templates = [repSt, asSt, periodSt];
  const pick = <K extends keyof SegmentTemplate>(key: K) =>
    findMap(templates, (st) => st?.[key]);

  return {
    "@_timescale": pick("@_timescale"),
    "@_startNumber": pick("@_startNumber"),
    "@_presentationTimeOffset": pick("@_presentationTimeOffset"),
    "@_duration": pick("@_duration"),
    "@_media": pick("@_media"),
    "@_index": pick("@_index"),
    "@_initialization": pick("@_initialization"),
    "@_bitstreamSwitching": pick("@_bitstreamSwitching"),
    "@_indexRange": pick("@_indexRange"),
    "@_indexRangeExact": pick("@_indexRangeExact"),
    "@_availabilityTimeOffset": pick("@_availabilityTimeOffset"),
    "@_availabilityTimeComplete": pick("@_availabilityTimeComplete"),
    SegmentTimeline: pick("SegmentTimeline"),
  };
}
