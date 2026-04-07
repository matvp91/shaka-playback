import type { MediaType } from "./types/manifest";

export enum ErrorCode {
  MANIFEST_LOAD_FAILED = "manifestLoadFailed",
  MANIFEST_CANCELLED = "manifestCancelled",
  SEGMENT_LOAD_FAILED = "segmentLoadFailed",
  SEGMENT_CANCELLED = "segmentCancelled",
}

export type ErrorDataMap = {
  [ErrorCode.MANIFEST_LOAD_FAILED]: {
    url: string;
    status: number | null;
  };
  [ErrorCode.MANIFEST_CANCELLED]: {
    url: string;
  };
  [ErrorCode.SEGMENT_LOAD_FAILED]: {
    url: string;
    mediaType: MediaType;
    status: number | null;
  };
  [ErrorCode.SEGMENT_CANCELLED]: {
    url: string;
    mediaType: MediaType;
  };
};

export type PlayerError<C extends ErrorCode = ErrorCode> = {
  code: C;
  fatal: boolean;
  data: ErrorDataMap[C];
};
