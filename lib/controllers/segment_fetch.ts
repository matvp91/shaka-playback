import type { InitSegment, Segment } from "../types";

/**
 * Segment fetcher with cancellation. One instance
 * per media type. Uses native fetch() and
 * AbortController internally.
 */
export class SegmentFetch {
  private controller_: AbortController | null = null;

  /**
   * Fetch segment data from network. Implicitly
   * cancels any previous in-flight request.
   * Returns null when the request was aborted.
   */
  async fetch(segment: Segment | InitSegment): Promise<ArrayBuffer | null> {
    this.controller_?.abort();
    this.controller_ = new AbortController();

    try {
      const response = await fetch(segment.url, {
        signal: this.controller_.signal,
      });
      const data = await response.arrayBuffer();
      this.controller_ = null;
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw error;
    }
  }

  /** Abort in-flight request. */
  cancel() {
    this.controller_?.abort();
    this.controller_ = null;
  }

  /** Whether a network request is in-flight. */
  isLoading(): boolean {
    return this.controller_ !== null;
  }
}
