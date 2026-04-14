import { describe, expect, it } from "vitest";
import { SegmentTracker } from "../../lib/media/segment_tracker";
import { MediaType } from "../../lib/types/media";
import { createSegment } from "../__framework__/factories";
import { createTimeRanges } from "../__framework__/time_ranges";

describe("SegmentTracker", () => {
  describe("trackAppend", () => {
    it("records a segment so its duration is retrievable", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 0, end: 4 }),
        new ArrayBuffer(1000),
      );
      expect(tracker.getLastSegmentDuration(MediaType.VIDEO)).toBe(4);
    });
  });

  describe("getEvictionEnd", () => {
    it("returns the eviction boundary that frees at least bytesNeeded", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 0, end: 4 }),
        new ArrayBuffer(500),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 4, end: 8 }),
        new ArrayBuffer(500),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 8, end: 12 }),
        new ArrayBuffer(500),
      );

      expect(tracker.getEvictionEnd(MediaType.VIDEO, 10, 800)).toBe(8);
    });

    it("skips segments whose end time is after currentTime", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 0, end: 4 }),
        new ArrayBuffer(500),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 4, end: 8 }),
        new ArrayBuffer(500),
      );

      expect(tracker.getEvictionEnd(MediaType.VIDEO, 2, 500)).toBe(0);
    });

    it("returns 0 when no segments are tracked for the media type", () => {
      const tracker = new SegmentTracker();
      expect(tracker.getEvictionEnd(MediaType.VIDEO, 0, 100)).toBe(0);
    });

    it("returns a partial eviction boundary when total bytes are insufficient", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 0, end: 4 }),
        new ArrayBuffer(100),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 4, end: 8 }),
        new ArrayBuffer(100),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 8, end: 12 }),
        new ArrayBuffer(500),
      );

      expect(tracker.getEvictionEnd(MediaType.VIDEO, 20, 5000)).toBe(12);
    });
  });

  describe("getLastSegmentDuration", () => {
    it("returns the duration of the most recently tracked segment", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 0, end: 4 }),
        new ArrayBuffer(500),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 4, end: 10 }),
        new ArrayBuffer(500),
      );
      expect(tracker.getLastSegmentDuration(MediaType.VIDEO)).toBe(6);
    });

    it("returns 0 when no segments have been tracked", () => {
      const tracker = new SegmentTracker();
      expect(tracker.getLastSegmentDuration(MediaType.VIDEO)).toBe(0);
    });
  });

  describe("reconcile", () => {
    it("removes tracked segments that are no longer in the buffer", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 0, end: 4 }),
        new ArrayBuffer(500),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 4, end: 8 }),
        new ArrayBuffer(500),
      );
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 8, end: 12 }),
        new ArrayBuffer(500),
      );

      tracker.reconcile(MediaType.VIDEO, createTimeRanges([6, 12]));

      expect(tracker.getEvictionEnd(MediaType.VIDEO, 20, 500)).toBe(12);
      expect(tracker.getLastSegmentDuration(MediaType.VIDEO)).toBe(4);
    });
  });

  describe("destroy", () => {
    it("clears all tracked segments", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(
        MediaType.VIDEO,
        createSegment({ start: 0, end: 4 }),
        new ArrayBuffer(500),
      );
      tracker.destroy();
      expect(tracker.getLastSegmentDuration(MediaType.VIDEO)).toBe(0);
    });
  });
});
