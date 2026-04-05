import type { Segment } from "../types/manifest";
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

type SegmentData = {
  initUrl: string;
  segments: Segment[];
  startNumber: number;
  startTime: number;
};

type SegmentInfo = {
  time: number;
  duration: number;
};

export function parseSegmentData(
  _mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  baseUrl: string,
): SegmentData {
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

  const initUrl = resolveUrl(
    applyUrlTemplate(initialization, representation),
    baseUrl,
  );

  const timescale = Number(st["@_timescale"]);
  assertNumber(timescale, "timescale is mandatory");

  const presentationTimeOffset = Number(st["@_presentationTimeOffset"] ?? 0);

  const startNumber = Number(st["@_startNumber"]);
  assertNumber(startNumber, "startNumber is mandatory");

  const firstT = Number(timeline.S[0]?.["@_t"]);
  assertNumber(firstT, "firstT is mandatory");
  const startTime = (firstT - presentationTimeOffset) / timescale;

  const infos = expandTimeline(timeline);
  const segments = mapTemplateTimeline(
    infos,
    media,
    st,
    representation,
    baseUrl,
  );

  return {
    initUrl,
    segments,
    startNumber,
    startTime,
  };
}

function mapTemplateTimeline(
  infos: SegmentInfo[],
  media: string,
  st: SegmentTemplate,
  representation: Representation,
  baseUrl: string,
): Segment[] {
  const timescale = Number(st["@_timescale"] ?? 1);
  const startNumber = Number(st["@_startNumber"] ?? 1);

  return infos.map<Segment>((info, i) => ({
    url: resolveUrl(
      applyUrlTemplate(media, representation, {
        Number: startNumber,
        Time: info.time,
      }),
      baseUrl,
    ),
    duration: info.duration / timescale,
  }));
}

function expandTimeline(timeline: SegmentTimeline): SegmentInfo[] {
  const infos: SegmentInfo[] = [];
  let time = 0;

  for (const s of timeline.S) {
    const d = Number(s["@_d"]);
    const r = Number(s["@_r"] ?? 0);

    if (s["@_t"] != null) {
      time = Number(s["@_t"]);
    }

    for (let i = 0; i <= r; i++) {
      infos.push({ time, duration: d });
      time += d;
    }
  }

  return infos;
}

function applyUrlTemplate(
  template: string,
  representation: Representation,
  vars?: { Number?: number; Time?: number },
): string {
  let result = template;
  result = result.replace(
    /\$RepresentationID\$/g,
    representation["@_id"] ?? "",
  );
  result = result.replace(
    /\$Bandwidth\$/g,
    representation["@_bandwidth"] ?? "",
  );
  if (vars?.Number != null) {
    result = result.replace(
      /\$Number(%0(\d+)d)?\$/g,
      (_, _fmt, width) =>
        width
          ? String(vars.Number).padStart(Number(width), "0")
          : String(vars.Number),
    );
  }
  if (vars?.Time != null) {
    result = result.replace(
      /\$Time(%0(\d+)d)?\$/g,
      (_, _fmt, width) =>
        width
          ? String(vars.Time).padStart(Number(width), "0")
          : String(vars.Time),
    );
  }
  return result;
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
