export type Manifest = {
  presentations: Presentation[];
};

export type Presentation = {
  start: number;
  end: number;
  selectionSets: SelectionSet[];
};

export type SelectionSet = {
  type: TrackType;
  switchingSets: SwitchingSet[];
};

export type SwitchingSet = {
  tracks: Track[];
};

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

export type Segment = {
  url: string;
  start: number;
  end: number;
};
