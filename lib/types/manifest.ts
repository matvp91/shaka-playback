export type Manifest = {
  presentations: Presentation[];
};

export type Presentation = {
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
  initUrl: string;
  segments: Segment[];
  codecs: string[];
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
  duration: number;
};
