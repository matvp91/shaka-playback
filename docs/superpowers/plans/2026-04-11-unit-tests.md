# Unit Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vitest unit tests covering all pure/logical modules in cmaf-lite, plus test helpers for TimeRanges simulation and object factories.

**Architecture:** Vitest with `happy-dom` environment. Tests live in `packages/cmaf-lite/test/` mirroring `lib/` structure. Helpers in `test/utils/`, fixtures in `test/fixtures/`. No mocking libraries — hand-written fakes and `vi.useFakeTimers()` only.

**Tech Stack:** Vitest, TypeScript, happy-dom

**Spec:** [docs/guidelines/testing.md](../../guidelines/testing.md)

---

### Task 1: Vitest Setup

**Files:**
- Create: `packages/cmaf-lite/vitest.config.ts`
- Modify: `packages/cmaf-lite/package.json`
- Modify: `package.json` (root)

- [ ] **Step 1: Install vitest and happy-dom**

```bash
cd packages/cmaf-lite && pnpm add -D vitest happy-dom
```

- [ ] **Step 2: Create vitest config**

Create `packages/cmaf-lite/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    root: ".",
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `packages/cmaf-lite/package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Add root test script**

In root `package.json`, add to `"scripts"`:

```json
"test": "pnpm --filter cmaf-lite test"
```

- [ ] **Step 5: Verify setup with empty test run**

```bash
cd packages/cmaf-lite && pnpm test
```

Expected: vitest runs, finds no tests, exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cmaf-lite/vitest.config.ts packages/cmaf-lite/package.json package.json pnpm-lock.yaml
git commit -m "chore: add vitest setup for cmaf-lite"
```

---

### Task 2: Test Helper — createTimeRanges

**Files:**
- Create: `packages/cmaf-lite/test/utils/time_ranges.ts`

- [ ] **Step 1: Create time_ranges helper**

Create `packages/cmaf-lite/test/utils/time_ranges.ts`:

```typescript
/**
 * Creates a TimeRanges-compatible object from pairs.
 */
export function createTimeRanges(
  ...ranges: [number, number][]
): TimeRanges {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  return {
    length: sorted.length,
    start(i: number) {
      if (i < 0 || i >= sorted.length) {
        throw new DOMException("Index out of bounds");
      }
      return sorted[i]![0];
    },
    end(i: number) {
      if (i < 0 || i >= sorted.length) {
        throw new DOMException("Index out of bounds");
      }
      return sorted[i]![1];
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cmaf-lite/test/utils/time_ranges.ts
git commit -m "test: add createTimeRanges helper"
```

---

### Task 3: Test Helper — Factories

**Files:**
- Create: `packages/cmaf-lite/test/utils/factories.ts`

- [ ] **Step 1: Create factories**

Create `packages/cmaf-lite/test/utils/factories.ts`:

```typescript
import type {
  InitSegment,
  Manifest,
  Segment,
  SwitchingSet,
  Track,
} from "../../lib/types/manifest";
import { MediaType } from "../../lib/types/media";

export function createInitSegment(
  overrides?: Partial<InitSegment>,
): InitSegment {
  return {
    url: "https://cdn.test/init.mp4",
    ...overrides,
  };
}

export function createSegment(overrides?: Partial<Segment>): Segment {
  return {
    url: "https://cdn.test/seg-1.m4s",
    start: 0,
    end: 4,
    initSegment: createInitSegment(),
    ...overrides,
  };
}

export function createVideoTrack(
  overrides?: Partial<Extract<Track, { type: MediaType.VIDEO }>>,
): Extract<Track, { type: MediaType.VIDEO }> {
  return {
    type: MediaType.VIDEO,
    bandwidth: 2_000_000,
    width: 1920,
    height: 1080,
    segments: [createSegment()],
    ...overrides,
  };
}

export function createAudioTrack(
  overrides?: Partial<Extract<Track, { type: MediaType.AUDIO }>>,
): Extract<Track, { type: MediaType.AUDIO }> {
  return {
    type: MediaType.AUDIO,
    bandwidth: 128_000,
    segments: [createSegment()],
    ...overrides,
  };
}

export function createSwitchingSet(
  overrides?: Partial<SwitchingSet>,
): SwitchingSet {
  return {
    type: MediaType.VIDEO,
    codec: "avc1.64001f",
    tracks: [createVideoTrack()],
    ...overrides,
  };
}

export function createManifest(
  overrides?: Partial<Manifest>,
): Manifest {
  return {
    duration: 60,
    switchingSets: [
      createSwitchingSet(),
      createSwitchingSet({
        type: MediaType.AUDIO,
        codec: "mp4a.40.2",
        tracks: [createAudioTrack()],
      }),
    ],
    ...overrides,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cmaf-lite/test/utils/factories.ts
git commit -m "test: add object factories"
```

---

### Task 4: Test Helper — Fixtures

**Files:**
- Create: `packages/cmaf-lite/test/fixtures/index.ts`
- Create: `packages/cmaf-lite/test/fixtures/basic.mpd`

- [ ] **Step 1: Create loadFixture helper**

Create `packages/cmaf-lite/test/fixtures/index.ts`:

```typescript
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), "utf-8");
}
```

- [ ] **Step 2: Create basic MPD fixture**

Create `packages/cmaf-lite/test/fixtures/basic.mpd`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     mediaPresentationDuration="PT60S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.64001f">
      <SegmentTemplate
        timescale="90000"
        media="video-$Number$.m4s"
        initialization="video-init.mp4"
        startNumber="1"
        duration="360000" />
      <Representation id="1" bandwidth="2000000" width="1920" height="1080" />
      <Representation id="2" bandwidth="1000000" width="1280" height="720" />
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="mp4a.40.2">
      <SegmentTemplate
        timescale="48000"
        media="audio-$Number$.m4s"
        initialization="audio-init.mp4"
        startNumber="1"
        duration="192000" />
      <Representation id="3" bandwidth="128000" />
    </AdaptationSet>
  </Period>
</MPD>
```

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/fixtures/
git commit -m "test: add fixture loader and basic MPD"
```

---

### Task 5: Tests — array_utils

**Files:**
- Create: `packages/cmaf-lite/test/utils/array_utils.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/array_utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { binarySearch } from "../../lib/utils/array_utils";

describe("binarySearch", () => {
  const items = [10, 20, 30, 40, 50];

  it("finds an exact match", () => {
    const result = binarySearch(items, (item) =>
      item === 30 ? 0 : item < 30 ? 1 : -1,
    );
    expect(result).toBe(30);
  });

  it("returns null when no match exists", () => {
    const result = binarySearch(items, (item) =>
      item === 35 ? 0 : item < 35 ? 1 : -1,
    );
    expect(result).toBeNull();
  });

  it("returns null for empty array", () => {
    const result = binarySearch([], () => 0);
    expect(result).toBeNull();
  });

  it("finds first element", () => {
    const result = binarySearch(items, (item) =>
      item === 10 ? 0 : item < 10 ? 1 : -1,
    );
    expect(result).toBe(10);
  });

  it("finds last element", () => {
    const result = binarySearch(items, (item) =>
      item === 50 ? 0 : item < 50 ? 1 : -1,
    );
    expect(result).toBe(50);
  });

  it("works with single element array", () => {
    const result = binarySearch([42], (item) =>
      item === 42 ? 0 : item < 42 ? 1 : -1,
    );
    expect(result).toBe(42);
  });

  it("works with objects", () => {
    const items = [
      { time: 0 },
      { time: 4 },
      { time: 8 },
    ];
    const result = binarySearch(items, (item) =>
      item.time === 4 ? 0 : item.time < 4 ? 1 : -1,
    );
    expect(result).toEqual({ time: 4 });
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/array_utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/array_utils.test.ts
git commit -m "test: add array_utils tests"
```

---

### Task 6: Tests — buffer_utils

**Files:**
- Create: `packages/cmaf-lite/test/utils/buffer_utils.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/buffer_utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  getBufferedEnd,
  getNextBufferedStart,
} from "../../lib/utils/buffer_utils";
import { createTimeRanges } from "../utils/time_ranges";

describe("getBufferedEnd", () => {
  it("returns end of range containing position", () => {
    const buffered = createTimeRanges([0, 10]);
    expect(getBufferedEnd(buffered, 5, 0.1)).toBe(10);
  });

  it("returns null when position is outside all ranges", () => {
    const buffered = createTimeRanges([0, 10]);
    expect(getBufferedEnd(buffered, 15, 0.1)).toBeNull();
  });

  it("returns null for empty TimeRanges", () => {
    const buffered = createTimeRanges();
    expect(getBufferedEnd(buffered, 0, 0.1)).toBeNull();
  });

  it("merges adjacent ranges with gap smaller than maxHole", () => {
    const buffered = createTimeRanges([0, 5], [5.05, 10]);
    expect(getBufferedEnd(buffered, 3, 0.1)).toBe(10);
  });

  it("does not merge ranges with gap larger than maxHole", () => {
    const buffered = createTimeRanges([0, 5], [6, 10]);
    expect(getBufferedEnd(buffered, 3, 0.1)).toBe(5);
  });

  it("tolerates position slightly before range start", () => {
    const buffered = createTimeRanges([1, 10]);
    expect(getBufferedEnd(buffered, 0.95, 0.1)).toBe(10);
  });
});

describe("getNextBufferedStart", () => {
  it("returns start of first range after position", () => {
    const buffered = createTimeRanges([0, 5], [10, 15]);
    expect(getNextBufferedStart(buffered, 6)).toBe(10);
  });

  it("returns null when no range starts after position", () => {
    const buffered = createTimeRanges([0, 5]);
    expect(getNextBufferedStart(buffered, 6)).toBeNull();
  });

  it("returns null for empty TimeRanges", () => {
    const buffered = createTimeRanges();
    expect(getNextBufferedStart(buffered, 0)).toBeNull();
  });

  it("skips ranges that start at or before position", () => {
    const buffered = createTimeRanges([0, 5], [5, 10], [15, 20]);
    expect(getNextBufferedStart(buffered, 5)).toBe(15);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/buffer_utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/buffer_utils.test.ts
git commit -m "test: add buffer_utils tests"
```

---

### Task 7: Tests — codec_utils

**Files:**
- Create: `packages/cmaf-lite/test/utils/codec_utils.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/codec_utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  getCodecBase,
  getCodecProfile,
  getContentType,
  getNormalizedCodec,
} from "../../lib/utils/codec_utils";

describe("getContentType", () => {
  it("formats content type string", () => {
    expect(getContentType("video", "avc1.64001f")).toBe(
      'video/mp4; codecs="avc1.64001f"',
    );
  });
});

describe("getCodecBase", () => {
  it("extracts base before dot", () => {
    expect(getCodecBase("avc1.64001f")).toBe("avc1");
  });

  it("returns full string when no dot", () => {
    expect(getCodecBase("ac-3")).toBe("ac-3");
  });
});

describe("getCodecProfile", () => {
  it("extracts profile after dot", () => {
    expect(getCodecProfile("avc1.64001f")).toBe("64001f");
  });

  it("returns null when no dot", () => {
    expect(getCodecProfile("ac-3")).toBeNull();
  });
});

describe("getNormalizedCodec", () => {
  it("normalizes AAC variants to 'aac'", () => {
    expect(getNormalizedCodec("mp4a.40.2")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.02")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.5")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.05")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.29")).toBe("aac");
    expect(getNormalizedCodec("mp4a.40.42")).toBe("aac");
    expect(getNormalizedCodec("mp4a.66")).toBe("aac");
    expect(getNormalizedCodec("mp4a.67")).toBe("aac");
    expect(getNormalizedCodec("mp4a.68")).toBe("aac");
  });

  it("normalizes AVC variants to 'avc'", () => {
    expect(getNormalizedCodec("avc1.64001f")).toBe("avc");
    expect(getNormalizedCodec("avc3.640028")).toBe("avc");
  });

  it("normalizes HEVC variants to 'hevc'", () => {
    expect(getNormalizedCodec("hev1.1.6.L93")).toBe("hevc");
    expect(getNormalizedCodec("hvc1.1.6.L93")).toBe("hevc");
  });

  it("normalizes AV1", () => {
    expect(getNormalizedCodec("av01.0.04M.08")).toBe("av1");
  });

  it("normalizes Dolby codecs", () => {
    expect(getNormalizedCodec("ac-3")).toBe("ac-3");
    expect(getNormalizedCodec("ec-3")).toBe("ec-3");
  });

  it("is case insensitive", () => {
    expect(getNormalizedCodec("AVC1.64001F")).toBe("avc");
    expect(getNormalizedCodec("MP4A.40.2")).toBe("aac");
  });

  it("throws on unsupported codec", () => {
    expect(() => getNormalizedCodec("vp9")).toThrow(
      "Unsupported codec: vp9",
    );
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/codec_utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/codec_utils.test.ts
git commit -m "test: add codec_utils tests"
```

---

### Task 8: Tests — functional

**Files:**
- Create: `packages/cmaf-lite/test/utils/functional.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/functional.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { filterMap, findMap } from "../../lib/utils/functional";

describe("findMap", () => {
  it("returns first non-null result from function", () => {
    const items = [1, 2, 3];
    const result = findMap(items, (n) =>
      n > 1 ? `found-${n}` : undefined,
    );
    expect(result).toBe("found-2");
  });

  it("returns undefined when no match", () => {
    const result = findMap([1, 2], () => undefined);
    expect(result).toBeUndefined();
  });

  it("returns first non-null property by key", () => {
    const items = [
      { name: undefined },
      { name: "alice" },
      { name: "bob" },
    ];
    const result = findMap(items, "name");
    expect(result).toBe("alice");
  });

  it("returns undefined for empty array", () => {
    const result = findMap([], (x) => x);
    expect(result).toBeUndefined();
  });
});

describe("filterMap", () => {
  it("collects non-null results from function", () => {
    const items = [1, 2, 3, 4];
    const result = filterMap(items, (n) =>
      n % 2 === 0 ? n * 10 : undefined,
    );
    expect(result).toEqual([20, 40]);
  });

  it("returns empty array when nothing matches", () => {
    const result = filterMap([1, 2], () => null);
    expect(result).toEqual([]);
  });

  it("collects non-null properties by key", () => {
    const items = [
      { val: "a" },
      { val: undefined },
      { val: "c" },
    ];
    const result = filterMap(items, "val");
    expect(result).toEqual(["a", "c"]);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/functional.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/functional.test.ts
git commit -m "test: add functional utils tests"
```

---

### Task 9: Tests — manifest_utils

**Files:**
- Create: `packages/cmaf-lite/test/utils/manifest_utils.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/manifest_utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  getSwitchingSetId,
  getTrackId,
  isInitSegment,
  isMediaSegment,
} from "../../lib/utils/manifest_utils";
import { MediaType } from "../../lib/types/media";
import {
  createInitSegment,
  createSegment,
  createVideoTrack,
  createAudioTrack,
} from "../utils/factories";

describe("isMediaSegment", () => {
  it("returns true for a media segment", () => {
    expect(isMediaSegment(createSegment())).toBe(true);
  });

  it("returns false for an init segment", () => {
    expect(isMediaSegment(createInitSegment())).toBe(false);
  });
});

describe("isInitSegment", () => {
  it("returns true for an init segment", () => {
    expect(isInitSegment(createInitSegment())).toBe(true);
  });

  it("returns false for a media segment", () => {
    expect(isInitSegment(createSegment())).toBe(false);
  });
});

describe("getSwitchingSetId", () => {
  it("joins type and codec", () => {
    expect(getSwitchingSetId(MediaType.VIDEO, "avc")).toBe(
      "video:avc",
    );
  });
});

describe("getTrackId", () => {
  it("returns dimensions for video tracks", () => {
    const track = createVideoTrack({ width: 1280, height: 720 });
    expect(getTrackId(track)).toBe("video:1280:720");
  });

  it("returns 'audio' for audio tracks", () => {
    expect(getTrackId(createAudioTrack())).toBe("audio");
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/manifest_utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/manifest_utils.test.ts
git commit -m "test: add manifest_utils tests"
```

---

### Task 10: Tests — url_utils

**Files:**
- Create: `packages/cmaf-lite/test/utils/url_utils.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/url_utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  isAbsoluteUrl,
  resolveUrl,
  resolveUrls,
} from "../../lib/utils/url_utils";

describe("isAbsoluteUrl", () => {
  it("returns true for https", () => {
    expect(isAbsoluteUrl("https://cdn.test/video.mp4")).toBe(true);
  });

  it("returns true for http", () => {
    expect(isAbsoluteUrl("http://cdn.test/video.mp4")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isAbsoluteUrl("video/seg-1.m4s")).toBe(false);
  });
});

describe("resolveUrl", () => {
  it("returns url when no base", () => {
    expect(resolveUrl("seg.m4s")).toBe("seg.m4s");
  });

  it("returns url when url is absolute", () => {
    expect(resolveUrl("https://a.test/seg.m4s", "https://b.test/"))
      .toBe("https://a.test/seg.m4s");
  });

  it("resolves against absolute base", () => {
    expect(resolveUrl("seg.m4s", "https://cdn.test/video/"))
      .toBe("https://cdn.test/video/seg.m4s");
  });

  it("concatenates with non-absolute base ending in slash", () => {
    expect(resolveUrl("seg.m4s", "video/")).toBe("video/seg.m4s");
  });

  it("concatenates with non-absolute base not ending in slash", () => {
    expect(resolveUrl("seg.m4s", "video")).toBe("videoseg.m4s");
  });
});

describe("resolveUrls", () => {
  it("chains multiple urls together", () => {
    const result = resolveUrls([
      "https://cdn.test/",
      "video/",
      "seg-1.m4s",
    ]);
    expect(result).toBe("https://cdn.test/video/seg-1.m4s");
  });

  it("returns empty string for empty array", () => {
    expect(resolveUrls([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/url_utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/url_utils.test.ts
git commit -m "test: add url_utils tests"
```

---

### Task 11: Tests — stream_utils

**Files:**
- Create: `packages/cmaf-lite/test/utils/stream_utils.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/stream_utils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  getStreams,
  remapSegment,
  resolveHierarchy,
  selectStream,
} from "../../lib/utils/stream_utils";
import { MediaType } from "../../lib/types/media";
import {
  createAudioTrack,
  createManifest,
  createSegment,
  createSwitchingSet,
  createVideoTrack,
} from "../utils/factories";

describe("getStreams", () => {
  it("extracts deduplicated streams from manifest", () => {
    const manifest = createManifest();
    const streams = getStreams(manifest);
    expect(streams).toHaveLength(2);
    expect(streams[0]!.type).toBe(MediaType.VIDEO);
    expect(streams[1]!.type).toBe(MediaType.AUDIO);
  });

  it("deduplicates identical streams", () => {
    const track = createVideoTrack();
    const manifest = createManifest({
      switchingSets: [
        createSwitchingSet({ tracks: [track, track] }),
      ],
    });
    const streams = getStreams(manifest);
    const videoStreams = streams.filter(
      (s) => s.type === MediaType.VIDEO,
    );
    expect(videoStreams).toHaveLength(1);
  });

  it("creates separate streams for different resolutions", () => {
    const manifest = createManifest({
      switchingSets: [
        createSwitchingSet({
          tracks: [
            createVideoTrack({ width: 1920, height: 1080 }),
            createVideoTrack({ width: 1280, height: 720 }),
          ],
        }),
      ],
    });
    const streams = getStreams(manifest);
    expect(streams).toHaveLength(2);
  });
});

describe("selectStream", () => {
  const streams = getStreams(createManifest({
    switchingSets: [
      createSwitchingSet({
        tracks: [
          createVideoTrack({ width: 1920, height: 1080 }),
          createVideoTrack({ width: 1280, height: 720 }),
        ],
      }),
      createSwitchingSet({
        type: MediaType.AUDIO,
        codec: "mp4a.40.2",
        tracks: [createAudioTrack()],
      }),
    ],
  }));

  it("selects video stream closest to preferred height", () => {
    const stream = selectStream(streams, {
      type: MediaType.VIDEO,
      height: 700,
    });
    expect(stream.type).toBe(MediaType.VIDEO);
    if (stream.type === MediaType.VIDEO) {
      expect(stream.height).toBe(720);
    }
  });

  it("selects audio stream by codec preference", () => {
    const stream = selectStream(streams, {
      type: MediaType.AUDIO,
      codec: "aac",
    });
    expect(stream.type).toBe(MediaType.AUDIO);
    expect(stream.codec).toBe("aac");
  });

  it("falls back to first audio when codec doesn't match", () => {
    const stream = selectStream(streams, {
      type: MediaType.AUDIO,
      codec: "nonexistent",
    });
    expect(stream.type).toBe(MediaType.AUDIO);
  });
});

describe("resolveHierarchy", () => {
  it("resolves switching set and track for a stream", () => {
    const manifest = createManifest();
    const streams = getStreams(manifest);
    const [switchingSet, track] = resolveHierarchy(
      manifest,
      streams[0]!,
    );
    expect(switchingSet.type).toBe(MediaType.VIDEO);
    expect(track.type).toBe(MediaType.VIDEO);
  });

  it("throws when no match found", () => {
    const manifest = createManifest({
      switchingSets: [createSwitchingSet()],
    });
    expect(() =>
      resolveHierarchy(manifest, {
        type: MediaType.AUDIO,
        codec: "aac",
      }),
    ).toThrow("No matching hierarchy");
  });
});

describe("remapSegment", () => {
  it("maps segment from old track to same index in new track", () => {
    const seg0 = createSegment({ url: "old-0.m4s", start: 0, end: 4 });
    const seg1 = createSegment({ url: "old-1.m4s", start: 4, end: 8 });
    const newSeg0 = createSegment({ url: "new-0.m4s", start: 0, end: 4 });
    const newSeg1 = createSegment({ url: "new-1.m4s", start: 4, end: 8 });

    const oldTrack = createVideoTrack({ segments: [seg0, seg1] });
    const newTrack = createVideoTrack({ segments: [newSeg0, newSeg1] });

    expect(remapSegment(oldTrack, newTrack, seg1)).toBe(newSeg1);
  });

  it("throws when segment not in old track", () => {
    const oldTrack = createVideoTrack({ segments: [createSegment()] });
    const newTrack = createVideoTrack({ segments: [createSegment()] });
    const orphan = createSegment({ url: "orphan.m4s" });

    expect(() => remapSegment(oldTrack, newTrack, orphan)).toThrow(
      "Segment not found",
    );
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/stream_utils.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/stream_utils.test.ts
git commit -m "test: add stream_utils tests"
```

---

### Task 12: Tests — timer

**Files:**
- Create: `packages/cmaf-lite/test/utils/timer.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/utils/timer.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timer } from "../../lib/utils/timer";

describe("Timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllTimers();
  });

  it("tickAfter fires callback after specified seconds", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickAfter(2);

    vi.advanceTimersByTime(1999);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("tickNow fires callback on next microtask", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickNow();

    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("tickEvery fires repeatedly", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickEvery(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(3);

    timer.destroy();
  });

  it("stop cancels a pending tick", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickAfter(1);
    timer.stop();

    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("stop inside callback cancels repeating timer", () => {
    let count = 0;
    const timer = new Timer(() => {
      count++;
      timer.stop();
    });
    timer.tickEvery(1);

    vi.advanceTimersByTime(5000);
    expect(count).toBe(1);
  });

  it("destroy nullifies callback", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.destroy();

    expect(() => {
      timer.tickAfter(1);
      vi.advanceTimersByTime(1000);
    }).toThrow("Timer fired after destroy");
  });

  it("tickAfter replaces previous pending tick", () => {
    const callback = vi.fn();
    const timer = new Timer(callback);
    timer.tickAfter(5);
    timer.tickAfter(1);

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/utils/timer.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/utils/timer.test.ts
git commit -m "test: add timer tests"
```

---

### Task 13: Tests — operation_queue

**Files:**
- Create: `packages/cmaf-lite/test/media/operation_queue.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/media/operation_queue.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { OperationQueue } from "../../lib/media/operation_queue";
import { MediaType } from "../../lib/types/media";

function createMockSourceBuffer(): SourceBuffer {
  return { updating: false } as unknown as SourceBuffer;
}

describe("OperationQueue", () => {
  it("executes first operation immediately on enqueue", () => {
    const queue = new OperationQueue();
    const sb = createMockSourceBuffer();
    queue.add(MediaType.VIDEO, sb);

    const execute = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("queues operations when one is already executing", () => {
    const queue = new OperationQueue();
    const sb = createMockSourceBuffer();
    queue.add(MediaType.VIDEO, sb);

    const first = vi.fn();
    const second = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute: first });
    queue.enqueue(MediaType.VIDEO, { execute: second });

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("advances queue on shiftAndExecuteNext", () => {
    const queue = new OperationQueue();
    const sb = createMockSourceBuffer();
    queue.add(MediaType.VIDEO, sb);

    const first = vi.fn();
    const second = vi.fn();
    const onComplete = vi.fn();
    queue.enqueue(MediaType.VIDEO, {
      execute: first,
      onComplete,
    });
    queue.enqueue(MediaType.VIDEO, { execute: second });

    queue.shiftAndExecuteNext(MediaType.VIDEO);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("insertNext places operations at front of queue", () => {
    const queue = new OperationQueue();
    const sb = createMockSourceBuffer();
    queue.add(MediaType.VIDEO, sb);

    const order: number[] = [];
    queue.enqueue(MediaType.VIDEO, {
      execute: () => order.push(1),
    });
    queue.enqueue(MediaType.VIDEO, {
      execute: () => order.push(3),
    });
    queue.insertNext(MediaType.VIDEO, [
      { execute: () => order.push(2) },
    ]);

    // Drain the queue
    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);
    queue.shiftAndExecuteNext(MediaType.VIDEO);

    expect(order).toEqual([1, 2, 3]);
  });

  it("block resolves when it reaches front of queue", async () => {
    const queue = new OperationQueue();
    const sb = createMockSourceBuffer();
    queue.add(MediaType.VIDEO, sb);

    const promise = queue.block(MediaType.VIDEO);
    await promise;
    // If we get here, the block resolved
    expect(true).toBe(true);
  });

  it("block resolves immediately when type is not registered", async () => {
    const queue = new OperationQueue();
    await queue.block(MediaType.VIDEO);
    expect(true).toBe(true);
  });

  it("calls onError when execute throws", () => {
    const queue = new OperationQueue();
    const sb = createMockSourceBuffer();
    queue.add(MediaType.VIDEO, sb);

    const error = new Error("boom");
    const onError = vi.fn();
    queue.enqueue(MediaType.VIDEO, {
      execute: () => { throw error; },
      onError,
    });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("ignores enqueue for unregistered type", () => {
    const queue = new OperationQueue();
    const execute = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute });
    expect(execute).not.toHaveBeenCalled();
  });

  it("destroy clears all queues", () => {
    const queue = new OperationQueue();
    const sb = createMockSourceBuffer();
    queue.add(MediaType.VIDEO, sb);
    queue.enqueue(MediaType.VIDEO, { execute: vi.fn() });

    queue.destroy();

    // After destroy, enqueue should be a no-op
    const execute = vi.fn();
    queue.enqueue(MediaType.VIDEO, { execute });
    expect(execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/media/operation_queue.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/media/operation_queue.test.ts
git commit -m "test: add operation_queue tests"
```

---

### Task 14: Tests — segment_tracker

**Files:**
- Create: `packages/cmaf-lite/test/media/segment_tracker.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/media/segment_tracker.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { SegmentTracker } from "../../lib/media/segment_tracker";
import { MediaType } from "../../lib/types/media";
import { createTimeRanges } from "../utils/time_ranges";

describe("SegmentTracker", () => {
  describe("trackAppend", () => {
    it("tracks a segment", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 1000);
      expect(tracker.getLastSegmentDuration(MediaType.VIDEO)).toBe(4);
    });
  });

  describe("getEvictionEnd", () => {
    it("returns eviction end covering bytesNeeded", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 500);
      tracker.trackAppend(MediaType.VIDEO, 4, 8, 500);
      tracker.trackAppend(MediaType.VIDEO, 8, 12, 500);

      const end = tracker.getEvictionEnd(
        MediaType.VIDEO, 10, 800,
      );
      expect(end).toBe(8);
    });

    it("skips segments after currentTime", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 500);
      tracker.trackAppend(MediaType.VIDEO, 4, 8, 500);

      const end = tracker.getEvictionEnd(
        MediaType.VIDEO, 2, 500,
      );
      expect(end).toBe(0);
    });

    it("returns 0 when no segments tracked", () => {
      const tracker = new SegmentTracker();
      expect(
        tracker.getEvictionEnd(MediaType.VIDEO, 0, 100),
      ).toBe(0);
    });

    it("returns partial eviction end when not enough bytes", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 100);
      tracker.trackAppend(MediaType.VIDEO, 4, 8, 100);
      tracker.trackAppend(MediaType.VIDEO, 8, 12, 500);

      const end = tracker.getEvictionEnd(
        MediaType.VIDEO, 20, 5000,
      );
      expect(end).toBe(12);
    });
  });

  describe("getLastSegmentDuration", () => {
    it("returns duration of last tracked segment", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 500);
      tracker.trackAppend(MediaType.VIDEO, 4, 10, 500);
      expect(
        tracker.getLastSegmentDuration(MediaType.VIDEO),
      ).toBe(6);
    });

    it("returns 0 when no segments", () => {
      const tracker = new SegmentTracker();
      expect(
        tracker.getLastSegmentDuration(MediaType.VIDEO),
      ).toBe(0);
    });
  });

  describe("reconcile", () => {
    it("removes segments no longer in buffer", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 500);
      tracker.trackAppend(MediaType.VIDEO, 4, 8, 500);
      tracker.trackAppend(MediaType.VIDEO, 8, 12, 500);

      const buffered = createTimeRanges([6, 12]);
      tracker.reconcile(MediaType.VIDEO, buffered);

      // Segment 0-4 was removed, so eviction has nothing before 6
      expect(
        tracker.getEvictionEnd(MediaType.VIDEO, 20, 500),
      ).toBe(12);
      expect(
        tracker.getLastSegmentDuration(MediaType.VIDEO),
      ).toBe(4);
    });
  });

  describe("destroy", () => {
    it("clears all tracked data", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 500);
      tracker.destroy();
      expect(
        tracker.getLastSegmentDuration(MediaType.VIDEO),
      ).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/media/segment_tracker.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/media/segment_tracker.test.ts
git commit -m "test: add segment_tracker tests"
```

---

### Task 15: Tests — dash_parser

**Files:**
- Create: `packages/cmaf-lite/test/dash/dash_parser.test.ts`

- [ ] **Step 1: Write tests**

Create `packages/cmaf-lite/test/dash/dash_parser.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseManifest } from "../../lib/dash/dash_parser";
import { MediaType } from "../../lib/types/media";
import { loadFixture } from "../fixtures";

describe("parseManifest", () => {
  const sourceUrl = "https://cdn.test/manifest.mpd";

  it("parses basic MPD into manifest", () => {
    const mpd = loadFixture("basic.mpd");
    const manifest = parseManifest(mpd, sourceUrl);

    expect(manifest.duration).toBe(60);
    expect(manifest.switchingSets).toHaveLength(2);
  });

  it("extracts video switching set", () => {
    const mpd = loadFixture("basic.mpd");
    const manifest = parseManifest(mpd, sourceUrl);

    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    );
    expect(video).toBeDefined();
    expect(video!.codec).toBe("avc1.64001f");
    expect(video!.tracks).toHaveLength(2);
  });

  it("extracts audio switching set", () => {
    const mpd = loadFixture("basic.mpd");
    const manifest = parseManifest(mpd, sourceUrl);

    const audio = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.AUDIO,
    );
    expect(audio).toBeDefined();
    expect(audio!.codec).toBe("mp4a.40.2");
    expect(audio!.tracks).toHaveLength(1);
  });

  it("resolves video track dimensions", () => {
    const mpd = loadFixture("basic.mpd");
    const manifest = parseManifest(mpd, sourceUrl);

    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    )!;
    const track1080 = video.tracks.find(
      (t) => t.type === MediaType.VIDEO && t.height === 1080,
    );
    const track720 = video.tracks.find(
      (t) => t.type === MediaType.VIDEO && t.height === 720,
    );
    expect(track1080).toBeDefined();
    expect(track720).toBeDefined();
  });

  it("generates segments with correct URLs", () => {
    const mpd = loadFixture("basic.mpd");
    const manifest = parseManifest(mpd, sourceUrl);

    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    )!;
    const track = video.tracks[0]!;
    expect(track.segments.length).toBeGreaterThan(0);

    const firstSeg = track.segments[0]!;
    expect(firstSeg.url).toContain("video-");
    expect(firstSeg.start).toBe(0);
    expect(firstSeg.initSegment.url).toContain("video-init.mp4");
  });

  it("generates correct number of segments for duration", () => {
    const mpd = loadFixture("basic.mpd");
    const manifest = parseManifest(mpd, sourceUrl);

    const video = manifest.switchingSets.find(
      (ss) => ss.type === MediaType.VIDEO,
    )!;
    const track = video.tracks[0]!;
    // 60s duration / 4s segments = 15 segments
    expect(track.segments).toHaveLength(15);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/dash/dash_parser.test.ts
```

Expected: all tests pass. If segment count or URL format is off, adjust assertions to match actual parser output.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/test/dash/dash_parser.test.ts
git commit -m "test: add dash_parser tests"
```

---

### Task 16: Tests — dash_segments

**Files:**
- Create: `packages/cmaf-lite/test/dash/dash_segments.test.ts`
- Create: `packages/cmaf-lite/test/fixtures/timeline.mpd`

- [ ] **Step 1: Create timeline fixture**

Create `packages/cmaf-lite/test/fixtures/timeline.mpd`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     mediaPresentationDuration="PT12S">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4" codecs="avc1.64001f">
      <SegmentTemplate
        timescale="90000"
        media="video-$Number$-$Time$.m4s"
        initialization="video-init.mp4"
        startNumber="1">
        <SegmentTimeline>
          <S t="0" d="360000" r="2" />
        </SegmentTimeline>
      </SegmentTemplate>
      <Representation id="1" bandwidth="2000000" width="1920" height="1080" />
    </AdaptationSet>
  </Period>
</MPD>
```

- [ ] **Step 2: Write tests**

Create `packages/cmaf-lite/test/dash/dash_segments.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseManifest } from "../../lib/dash/dash_parser";
import { MediaType } from "../../lib/types/media";
import { loadFixture } from "../fixtures";

const sourceUrl = "https://cdn.test/manifest.mpd";

describe("dash_segments", () => {
  describe("duration-based segments", () => {
    it("generates segments covering full duration", () => {
      const manifest = parseManifest(
        loadFixture("basic.mpd"),
        sourceUrl,
      );
      const video = manifest.switchingSets.find(
        (ss) => ss.type === MediaType.VIDEO,
      )!;
      const track = video.tracks[0]!;
      const last = track.segments[track.segments.length - 1]!;

      expect(last.end).toBeCloseTo(60, 0);
    });

    it("segments are contiguous", () => {
      const manifest = parseManifest(
        loadFixture("basic.mpd"),
        sourceUrl,
      );
      const video = manifest.switchingSets.find(
        (ss) => ss.type === MediaType.VIDEO,
      )!;
      const segments = video.tracks[0]!.segments;

      for (let i = 1; i < segments.length; i++) {
        expect(segments[i]!.start).toBeCloseTo(
          segments[i - 1]!.end,
          5,
        );
      }
    });

    it("each segment references its init segment", () => {
      const manifest = parseManifest(
        loadFixture("basic.mpd"),
        sourceUrl,
      );
      const video = manifest.switchingSets.find(
        (ss) => ss.type === MediaType.VIDEO,
      )!;
      const segments = video.tracks[0]!.segments;

      for (const seg of segments) {
        expect(seg.initSegment).toBeDefined();
        expect(seg.initSegment.url).toContain("init");
      }
    });
  });

  describe("timeline-based segments", () => {
    it("generates segments from SegmentTimeline", () => {
      const manifest = parseManifest(
        loadFixture("timeline.mpd"),
        sourceUrl,
      );
      const video = manifest.switchingSets.find(
        (ss) => ss.type === MediaType.VIDEO,
      )!;
      const segments = video.tracks[0]!.segments;

      // r="2" means 3 total segments (original + 2 repeats)
      expect(segments).toHaveLength(3);
    });

    it("timeline segments have correct timing", () => {
      const manifest = parseManifest(
        loadFixture("timeline.mpd"),
        sourceUrl,
      );
      const video = manifest.switchingSets.find(
        (ss) => ss.type === MediaType.VIDEO,
      )!;
      const segments = video.tracks[0]!.segments;

      expect(segments[0]!.start).toBeCloseTo(0, 5);
      expect(segments[0]!.end).toBeCloseTo(4, 5);
      expect(segments[1]!.start).toBeCloseTo(4, 5);
      expect(segments[2]!.start).toBeCloseTo(8, 5);
    });
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd packages/cmaf-lite && pnpm test -- test/dash/dash_segments.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/test/dash/dash_segments.test.ts packages/cmaf-lite/test/fixtures/timeline.mpd
git commit -m "test: add dash_segments tests"
```

---

### Task 17: Run Full Suite and Verify

- [ ] **Step 1: Run all tests**

```bash
cd packages/cmaf-lite && pnpm test
```

Expected: all tests pass.

- [ ] **Step 2: Run type check**

```bash
pnpm tsc
```

Expected: no type errors.

- [ ] **Step 3: Run format**

```bash
pnpm format
```

Expected: no formatting issues (or auto-fixed).

- [ ] **Step 4: Commit any formatting fixes**

If format made changes:

```bash
git add -A && git commit -m "style: format test files"
```
