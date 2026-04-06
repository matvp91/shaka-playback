export type Manifest = {
  presentations: Presentation[];
};

/**
 * Simultaneously decoded Selection Sets producing
 * a multimedia experience.
 */
export type Presentation = {
  start: number;
  end: number;
  selectionSets: SelectionSet[];
};

/**
 * Mutually exclusive Switching Sets, one active
 * at a time (eg. language, codec).
 */
export type SelectionSet = {
  type: TrackType;
  switchingSets: SwitchingSet[];
};

/**
 * Alternative encodings of the same content,
 * seamlessly switchable.
 */
export type SwitchingSet = {
  tracks: Track[];
};

/**
 * Single media stream as a sequence of Segments.
 */
export type Track = {
  mimeType: string;
  codec: string;
  initSegmentUrl: string;
  segments: Segment[];
  timeOffset: number;
  bandwidth: number;
} & (
  | {
      type: TrackType.VIDEO;
      width: number;
      height: number;
    }
  | {
      type: TrackType.AUDIO;
    }
);

export enum TrackType {
  VIDEO = "video",
  AUDIO = "audio",
  TEXT = "text",
}

/**
 * Addressable media object, one or more
 * consecutive Segments from a Track.
 */
export type Segment = {
  url: string;
  start: number;
  end: number;
};
