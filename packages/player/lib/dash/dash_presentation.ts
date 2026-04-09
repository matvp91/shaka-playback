import { processUriTemplate } from "@svta/cml-dash";
import { decodeIso8601Duration } from "@svta/cml-iso-8601";
import type { InitSegment, Segment } from "../types/manifest";
import { assertNotVoid } from "../utils/assert";
import { findMap } from "../utils/functional";
import { asNumber } from "../utils/parse";
import { resolveUrl } from "../utils/url";
import type {
  AdaptationSet,
  MPD,
  Period,
  Representation,
  SegmentTemplate,
  SegmentTimeline,
} from "./dash_types";

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

  const timescale = asNumber(st["@_timescale"]);
  assertNotVoid(timescale, "timescale is mandatory");

  const bandwidth = asNumber(representation["@_bandwidth"]);
  assertNotVoid(bandwidth, "bandwidth is mandatory");

  const pto = asNumber(st["@_presentationTimeOffset"]) ?? 0;

  const periodStart = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const initSegmentUrl = resolveUrl(
    processUriTemplate(
      initialization,
      representation["@_id"],
      null,
      null,
      bandwidth,
      null,
    ),
    baseUrl,
  );

  const segments = mapTemplateTimeline(
    timeline,
    media,
    st,
    representation,
    baseUrl,
    bandwidth,
    pto,
    periodStart,
  );

  const initSegment: InitSegment = {
    url: initSegmentUrl,
  };

  return { initSegment, segments };
}

function mapTemplateTimeline(
  timeline: SegmentTimeline,
  media: string,
  st: SegmentTemplate,
  representation: Representation,
  baseUrl: string,
  bandwidth: number,
  pto: number,
  periodStart: number,
): Segment[] {
  const timescale = asNumber(st["@_timescale"]) ?? 1;
  const startNumber = asNumber(st["@_startNumber"]) ?? 1;
  const segments: Segment[] = [];
  let time = 0;
  let number = startNumber;

  for (const s of timeline.S) {
    const d = asNumber(s["@_d"]);
    assertNotVoid(d, "segment duration is mandatory");
    const r = asNumber(s["@_r"]) ?? 0;

    const t = asNumber(s["@_t"]);
    if (t != null) {
      time = t;
    }

    for (let i = 0; i <= r; i++) {
      const relativeUrl = processUriTemplate(
        media,
        representation["@_id"],
        number,
        null,
        bandwidth,
        time,
      );
      const url = resolveUrl(relativeUrl, baseUrl);
      segments.push({
        url,
        start: (time - pto) / timescale + periodStart,
        end: (time - pto + d) / timescale + periodStart,
      });
      time += d;
      number++;
    }
  }

  return segments;
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
