import { processUriTemplate } from "@svta/cml-dash";
import { decodeIso8601Duration } from "@svta/cml-iso-8601";
import type { InitSegment, Segment } from "../types/manifest";
import * as asserts from "../utils/asserts";
import * as Functional from "../utils/functional";
import * as UrlUtils from "../utils/url_utils";
import * as XmlUtils from "../utils/xml_utils";
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
  duration: number | null,
) {
  const st = resolveSegmentTemplate(
    period.SegmentTemplate,
    adaptationSet.SegmentTemplate,
    representation.SegmentTemplate,
  );

  const initialization = st["@_initialization"];
  asserts.assertExists(initialization, "initialization is mandatory");

  const media = st["@_media"];
  asserts.assertExists(media, "media is mandatory");

  const timescale = XmlUtils.asNumber(st["@_timescale"]);
  asserts.assertExists(timescale, "timescale is mandatory");

  const bandwidth = XmlUtils.asNumber(representation["@_bandwidth"]);
  asserts.assertExists(bandwidth, "bandwidth is mandatory");

  const pto = XmlUtils.asNumber(st["@_presentationTimeOffset"]) ?? 0;

  const periodStart = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const initSegmentUrl = UrlUtils.resolveUrl(
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

  const initSegment: InitSegment = {
    url: initSegmentUrl,
  };

  const segments = st.SegmentTimeline
    ? mapTemplateTimeline(
        st.SegmentTimeline,
        media,
        st,
        representation,
        baseUrl,
        bandwidth,
        pto,
        periodStart,
        initSegment,
      )
    : mapTemplateDuration(
        st,
        media,
        representation,
        baseUrl,
        bandwidth,
        pto,
        periodStart,
        duration,
        initSegment,
      );

  return { segments };
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
  initSegment: InitSegment,
): Segment[] {
  const timescale = XmlUtils.asNumber(st["@_timescale"]) ?? 1;
  const startNumber = XmlUtils.asNumber(st["@_startNumber"]) ?? 1;
  const segments: Segment[] = [];
  let time = 0;
  let number = startNumber;

  for (const s of timeline.S) {
    const d = XmlUtils.asNumber(s["@_d"]);
    asserts.assertExists(d, "segment duration is mandatory");
    const r = XmlUtils.asNumber(s["@_r"]) ?? 0;

    const t = XmlUtils.asNumber(s["@_t"]);
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
      const url = UrlUtils.resolveUrl(relativeUrl, baseUrl);
      segments.push({
        url,
        start: (time - pto) / timescale + periodStart,
        end: (time - pto + d) / timescale + periodStart,
        initSegment,
      });
      time += d;
      number++;
    }
  }

  return segments;
}

function mapTemplateDuration(
  st: SegmentTemplate,
  media: string,
  representation: Representation,
  baseUrl: string,
  bandwidth: number,
  pto: number,
  periodStart: number,
  presentationDuration: number | null,
  initSegment: InitSegment,
): Segment[] {
  asserts.assertExists(
    presentationDuration,
    "Duration-based addressing requires a resolvable presentation duration",
  );

  const templateDuration = XmlUtils.asNumber(st["@_duration"]);
  asserts.assertExists(
    templateDuration,
    "SegmentTemplate requires either SegmentTimeline or @duration",
  );

  const timescale = XmlUtils.asNumber(st["@_timescale"]) ?? 1;
  const startNumber = XmlUtils.asNumber(st["@_startNumber"]) ?? 1;
  const segmentDuration = templateDuration / timescale;
  const segmentCount = Math.ceil(presentationDuration / segmentDuration);

  const segments: Segment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const number = startNumber + i;
    const time = i * templateDuration;
    const relativeUrl = processUriTemplate(
      media,
      representation["@_id"],
      number,
      null,
      bandwidth,
      time,
    );
    const url = UrlUtils.resolveUrl(relativeUrl, baseUrl);
    segments.push({
      url,
      start: (time - pto) / timescale + periodStart,
      end: (time - pto + templateDuration) / timescale + periodStart,
      initSegment,
    });
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
    Functional.findMap(templates, (st) => st?.[key]);

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
