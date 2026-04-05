export type MPD = {
  BaseURL?: TextNode;
  Period: Period[];
};

export type Period = {
  BaseURL?: TextNode;
  SegmentTemplate?: SegmentTemplate;
  AdaptationSet: AdaptationSet[];
};

export type AdaptationSet = {
  "@_group"?: string;
  "@_contentType"?: string;
  "@_mimeType"?: string;
  "@_codecs"?: string;
  "@_width"?: string;
  "@_height"?: string;
  BaseURL?: TextNode;
  SegmentTemplate?: SegmentTemplate;
  Representation: Representation[];
};

export type Representation = {
  "@_id"?: string;
  "@_bandwidth"?: string;
  "@_mimeType"?: string;
  "@_codecs"?: string;
  "@_width"?: string;
  "@_height"?: string;
  BaseURL?: TextNode;
  SegmentTemplate?: SegmentTemplate;
};

export type TextNode = {
  "#text": string;
};

export type SegmentTemplate = {
  "@_timescale"?: string;
  "@_startNumber"?: string;
  "@_presentationTimeOffset"?: string;
  "@_duration"?: string;
  "@_media"?: string;
  "@_index"?: string;
  "@_initialization"?: string;
  "@_bitstreamSwitching"?: string;
  "@_indexRange"?: string;
  "@_indexRangeExact"?: string;
  "@_availabilityTimeOffset"?: string;
  "@_availabilityTimeComplete"?: string;
  SegmentTimeline?: SegmentTimeline;
};

export type SegmentTimeline = {
  S: SegmentTimelineEntry[];
};

export type SegmentTimelineEntry = {
  "@_t"?: string;
  "@_d": string;
  "@_r"?: string;
};
