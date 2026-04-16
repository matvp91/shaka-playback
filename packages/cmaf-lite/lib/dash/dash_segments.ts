import { processUriTemplate } from "@svta/cml-dash";
import type * as txml from "txml";
import type { InitSegment, Segment } from "../types/manifest";
import * as asserts from "../utils/asserts";
import * as Functional from "../utils/functional";
import * as UrlUtils from "../utils/url_utils";
import * as XmlUtils from "../utils/xml_utils";

type SegmentData = {
  segments: Segment[];
  maxSegmentDuration: number;
};

export function parseSegmentData(
  period: txml.TNode,
  adaptationSet: txml.TNode,
  representation: txml.TNode,
  baseUrl: string,
  bandwidth: number,
  duration: number | null,
): SegmentData {
  const st = resolveSegmentTemplate(period, adaptationSet, representation);

  const initialization = XmlUtils.attr(
    st,
    "initialization",
    XmlUtils.parseString,
  );
  asserts.assertExists(initialization, "initialization is mandatory");

  const periodStart =
    XmlUtils.attr(period, "start", XmlUtils.parseDuration) ?? 0;

  const id = XmlUtils.attr(representation, "id", XmlUtils.parseString);

  const initSegment: InitSegment = {
    url: UrlUtils.resolveUrl(
      processUriTemplate(initialization, id, null, null, bandwidth, null),
      baseUrl,
    ),
  };

  const timeline = XmlUtils.child(st, "SegmentTimeline");
  return timeline
    ? mapTemplateTimeline(
        st,
        timeline,
        id,
        baseUrl,
        bandwidth,
        periodStart,
        initSegment,
      )
    : mapTemplateDuration(
        st,
        id,
        baseUrl,
        bandwidth,
        periodStart,
        duration,
        initSegment,
      );
}

function mapTemplateTimeline(
  st: txml.TNode,
  timeline: txml.TNode,
  id: string | undefined,
  baseUrl: string,
  bandwidth: number,
  periodStart: number,
  initSegment: InitSegment,
): SegmentData {
  const media = XmlUtils.attr(st, "media", XmlUtils.parseString);
  asserts.assertExists(media, "media is mandatory");

  const timescale = XmlUtils.attr(st, "timescale", XmlUtils.parseNumber) ?? 1;
  const startNumber =
    XmlUtils.attr(st, "startNumber", XmlUtils.parseNumber) ?? 1;
  const pto =
    XmlUtils.attr(st, "presentationTimeOffset", XmlUtils.parseNumber) ?? 0;

  const segments: Segment[] = [];
  let maxSegmentDuration = 0;
  let time = 0;
  let number = startNumber;

  for (const s of XmlUtils.children(timeline, "S")) {
    const d = XmlUtils.attr(s, "d", XmlUtils.parseNumber);
    asserts.assertExists(d, "segment duration is mandatory");
    const r = XmlUtils.attr(s, "r", XmlUtils.parseNumber) ?? 0;

    time = XmlUtils.attr(s, "t", XmlUtils.parseNumber) ?? time;

    for (let i = 0; i <= r; i++) {
      const relativeUrl = processUriTemplate(
        media,
        id,
        number,
        null,
        bandwidth,
        time,
      );
      const url = UrlUtils.resolveUrl(relativeUrl, baseUrl);
      const start = (time - pto) / timescale + periodStart;
      const end = (time - pto + d) / timescale + periodStart;
      segments.push({ url, start, end, initSegment });
      maxSegmentDuration = Math.max(maxSegmentDuration, end - start);
      time += d;
      number++;
    }
  }

  return { segments, maxSegmentDuration };
}

function mapTemplateDuration(
  st: txml.TNode,
  id: string | undefined,
  baseUrl: string,
  bandwidth: number,
  periodStart: number,
  presentationDuration: number | null,
  initSegment: InitSegment,
): SegmentData {
  const media = XmlUtils.attr(st, "media", XmlUtils.parseString);
  asserts.assertExists(media, "media is mandatory");
  asserts.assertExists(
    presentationDuration,
    "Duration-based addressing requires a resolvable presentation duration",
  );

  const templateDuration = XmlUtils.attr(st, "duration", XmlUtils.parseNumber);
  asserts.assertExists(
    templateDuration,
    "SegmentTemplate requires either SegmentTimeline or @duration",
  );

  const timescale = XmlUtils.attr(st, "timescale", XmlUtils.parseNumber) ?? 1;
  const startNumber =
    XmlUtils.attr(st, "startNumber", XmlUtils.parseNumber) ?? 1;
  const pto =
    XmlUtils.attr(st, "presentationTimeOffset", XmlUtils.parseNumber) ?? 0;

  const segmentDuration = templateDuration / timescale;
  const segmentCount = Math.ceil(presentationDuration / segmentDuration);

  const segments: Segment[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const number = startNumber + i;
    const time = i * templateDuration;
    const relativeUrl = processUriTemplate(
      media,
      id,
      number,
      null,
      bandwidth,
      time,
    );
    const url = UrlUtils.resolveUrl(relativeUrl, baseUrl);
    const start = (time - pto) / timescale + periodStart;
    const end = (time - pto + templateDuration) / timescale + periodStart;
    segments.push({ url, start, end, initSegment });
  }

  return { segments, maxSegmentDuration: segmentDuration };
}

function resolveSegmentTemplate(
  period: txml.TNode,
  adaptationSet: txml.TNode,
  representation: txml.TNode,
): txml.TNode {
  const templates = [
    XmlUtils.child(representation, "SegmentTemplate"),
    XmlUtils.child(adaptationSet, "SegmentTemplate"),
    XmlUtils.child(period, "SegmentTemplate"),
  ].filter((t): t is txml.TNode => t !== undefined);

  if (templates.length === 0) {
    throw new Error("We've got to have some sort of templating");
  }

  // Parent → child iteration so child attributes overwrite parent's.
  const attributes: Record<string, string | null> = {};
  for (const t of templates.slice().reverse()) {
    Object.assign(attributes, t.attributes);
  }

  const segmentTimeline = Functional.findMap(templates, (t) =>
    XmlUtils.child(t, "SegmentTimeline"),
  );

  return {
    tagName: "SegmentTemplate",
    attributes,
    children: segmentTimeline ? [segmentTimeline] : [],
  };
}
