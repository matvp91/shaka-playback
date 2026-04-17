# Resolve Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor preference-driven stream selection to separate content
matching (strict-equality preferences) from quality selection (bandwidth
anchoring on the active video stream), and centralise the combined
"pick a stream" flow in a single `StreamController.resolveStream_` method.

**Architecture:**

- `VideoPreference` loses `height` — preferences are purely content descriptors
  (codec, language, channels).
- `stream_utils` exposes `findStreamsMatchingPreferences` (returns the match
  set for the first priority-matching preference) and
  `pickClosestByBandwidth` (video-only, anchors on the active stream).
- `StreamController` exposes `resolveStream_`, which combines the two
  helpers with the active stream + available streams to yield a single
  chosen stream. Called from `tryStart_`.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest + happy-dom, Biome.

**Spec:** `.agents/superpowers/specs/2026-04-17-resolve-stream-design.md`

---

## Pre-flight

- [ ] **Step 0.1: Confirm starting state**

Run: `pnpm tsc && pnpm test`
Expected: all pass on the current branch.

---

## Task 1: Remove `height` from `VideoPreference`

**Files:**

- Modify: `packages/cmaf-lite/lib/types/media.ts:108-112`
- Modify: `packages/cmaf-lite/lib/utils/stream_utils.ts:66-82` (simplify the
  now-obsolete `pickWithinTier`)

- [ ] **Step 1.1: Remove `height` from `VideoPreference`**

Edit `packages/cmaf-lite/lib/types/media.ts`. Replace:

```ts
/**
 * Video preference.
 *
 * @public
 */
export interface VideoPreference extends BasePreference {
  type: MediaType.VIDEO;
  height?: number;
}
```

with:

```ts
/**
 * Video preference.
 *
 * @public
 */
export interface VideoPreference extends BasePreference {
  type: MediaType.VIDEO;
}
```

- [ ] **Step 1.2: Inline `pickWithinTier` to `matches[0]` (no more height branch)**

Edit `packages/cmaf-lite/lib/utils/stream_utils.ts`. Replace the existing
`pickWithinTier` function body + its call site so `findBestSuitableStream`
directly returns `matches[0]` when it has matches.

Replace:

```ts
export function findBestSuitableStream<T extends MediaType>(
  type: T,
  streams: Stream<T>[],
  preferences: Preference[],
): Stream | null {
  asserts.assertExists(streams[0], "No Streams");

  for (const preference of preferences) {
    if (preference.type !== type) {
      continue;
    }
    const matches = streams.filter((s) => matchesPreference(s, preference));
    if (matches.length === 0) {
      continue;
    }
    return pickWithinTier(matches, preference);
  }

  return null;
}

function matchesPreference(stream: Stream, preference: Preference): boolean {
  if (preference.codec !== undefined && stream.codec !== preference.codec) {
    return false;
  }
  // TODO(matvp): language/channels matching once those fields
  // are added to AudioStream/SubtitleStream.
  return true;
}

function pickWithinTier(matches: Stream[], preference: Preference): Stream {
  const first = matches[0];
  asserts.assertExists(first, "pickWithinTier requires a non-empty list");
  if (preference.type !== MediaType.VIDEO || preference.height === undefined) {
    return first;
  }
  // All matches share the preference type, so they are all video.
  const videoMatches = matches as Stream<MediaType.VIDEO>[];
  const target = preference.height;
  let best = videoMatches[0] as Stream<MediaType.VIDEO>;
  for (const stream of videoMatches) {
    if (Math.abs(stream.height - target) < Math.abs(best.height - target)) {
      best = stream;
    }
  }
  return best;
}
```

with (intermediate shape — still exports `findBestSuitableStream`, returning
a single stream, so we keep the old call site green; gets fully reshaped in
Task 2):

```ts
export function findBestSuitableStream<T extends MediaType>(
  type: T,
  streams: Stream<T>[],
  preferences: Preference[],
): Stream | null {
  asserts.assertExists(streams[0], "No Streams");

  for (const preference of preferences) {
    if (preference.type !== type) {
      continue;
    }
    const matches = streams.filter((s) => matchesPreference(s, preference));
    if (matches.length === 0) {
      continue;
    }
    return matches[0]!;
  }

  return null;
}

function matchesPreference(stream: Stream, preference: Preference): boolean {
  if (preference.codec !== undefined && stream.codec !== preference.codec) {
    return false;
  }
  // TODO(matvp): language/channels matching once those fields
  // are added to AudioStream/SubtitleStream.
  return true;
}
```

- [ ] **Step 1.3: Verify types and tests**

Run: `pnpm tsc && pnpm test`
Expected: all pass. No existing tests reference `height` on a preference.

- [ ] **Step 1.4: Commit**

```bash
git add packages/cmaf-lite/lib/types/media.ts packages/cmaf-lite/lib/utils/stream_utils.ts
git commit -m "Remove height from VideoPreference"
```

---

## Task 2: Reshape to `findStreamsMatchingPreferences`

Rename the function and change its return type from `Stream | null` to
`Stream<T>[] | null`. Caller (`StreamController.tryStart_`) gets updated to
pick the first match in the meantime; bandwidth anchoring comes in Task 4.

**Files:**

- Modify: `packages/cmaf-lite/lib/utils/stream_utils.ts`
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts:165-173`
- Modify: `packages/cmaf-lite/test/utils/stream_utils.test.ts`

- [ ] **Step 2.1: Write failing tests for `findStreamsMatchingPreferences`**

Edit `packages/cmaf-lite/test/utils/stream_utils.test.ts`. Add a new
`describe` block alongside the existing `buildStreams` one:

```ts
import { describe, expect, it } from "vitest";
import { MediaType } from "../../lib/types/media";
import type { Preference, VideoStream } from "../../lib/types/media";
import {
  buildStreams,
  findStreamsMatchingPreferences,
} from "../../lib/utils/stream_utils";
import {
  createManifest,
  createVideoSwitchingSet,
  createVideoTrack,
} from "../__framework__/factories";

// ... existing buildStreams describe stays ...

describe("findStreamsMatchingPreferences", () => {
  const videoStreams = (): VideoStream[] => {
    const manifest = createManifest({
      switchingSets: [
        createVideoSwitchingSet({
          codec: "avc1.64001f",
          tracks: [
            createVideoTrack({ bandwidth: 1_000_000 }),
            createVideoTrack({ bandwidth: 3_000_000, width: 1280, height: 720 }),
          ],
        }),
        createVideoSwitchingSet({
          codec: "av01.0.05M.08",
          tracks: [createVideoTrack({ bandwidth: 2_000_000 })],
        }),
      ],
    });
    const list = buildStreams(manifest).get(MediaType.VIDEO) ?? [];
    return list.filter(
      (s): s is VideoStream => s.type === MediaType.VIDEO,
    );
  };

  it("returns all matching streams for the first type-matching preference", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.VIDEO, codec: "avc1.64001f" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(2);
    expect(result!.every((s) => s.codec === "avc1.64001f")).toBe(true);
  });

  it("skips preferences whose type does not match the requested type", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.AUDIO, codec: "mp4a.40.2" },
      { type: MediaType.VIDEO, codec: "av01.0.05M.08" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(1);
    expect(result![0]!.codec).toBe("av01.0.05M.08");
  });

  it("returns the match set for the earliest preference that yields hits", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.VIDEO, codec: "hev1.2.4.L120.90" },
      { type: MediaType.VIDEO, codec: "avc1.64001f" },
      { type: MediaType.VIDEO, codec: "av01.0.05M.08" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(2);
    expect(result!.every((s) => s.codec === "avc1.64001f")).toBe(true);
  });

  it("returns null when no preference matches any stream", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [
      { type: MediaType.VIDEO, codec: "hev1.2.4.L120.90" },
    ];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toBeNull();
  });

  it("returns null when preferences list is empty", () => {
    const streams = videoStreams();
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      [],
    );
    expect(result).toBeNull();
  });

  it("treats an undefined codec field as an unconstrained match", () => {
    const streams = videoStreams();
    const preferences: Preference[] = [{ type: MediaType.VIDEO }];
    const result = findStreamsMatchingPreferences(
      MediaType.VIDEO,
      streams,
      preferences,
    );
    expect(result).toHaveLength(streams.length);
  });
});
```

- [ ] **Step 2.2: Verify tests fail**

Run: `pnpm --filter cmaf-lite test -- stream_utils`
Expected: FAIL — `findStreamsMatchingPreferences` is not exported.

- [ ] **Step 2.3: Implement `findStreamsMatchingPreferences` and delete old function**

Edit `packages/cmaf-lite/lib/utils/stream_utils.ts`. Replace the
intermediate `findBestSuitableStream` (from Task 1) with:

```ts
export function findStreamsMatchingPreferences<T extends MediaType>(
  type: T,
  streams: Stream<T>[],
  preferences: Preference[],
): Stream<T>[] | null {
  asserts.assertExists(streams[0], "No Streams");

  for (const preference of preferences) {
    if (preference.type !== type) {
      continue;
    }
    const matches = streams.filter((s) => matchesPreference(s, preference));
    if (matches.length === 0) {
      continue;
    }
    return matches;
  }

  return null;
}

function matchesPreference(stream: Stream, preference: Preference): boolean {
  if (preference.codec !== undefined && stream.codec !== preference.codec) {
    return false;
  }
  // TODO(matvp): language/channels matching once those fields
  // are added to AudioStream/SubtitleStream.
  return true;
}
```

- [ ] **Step 2.4: Update `StreamController.tryStart_` call site (temporary shape)**

Edit `packages/cmaf-lite/lib/media/stream_controller.ts`. Replace the block
at lines 165-173:

```ts
const { preferences } = this.player_.getConfig();
for (const [type, streams] of this.streamsMap_) {
  const stream =
    StreamUtils.findBestSuitableStream(type, streams, preferences) ??
    this.streams_.get(type) ??
    streams[0];
  asserts.assertExists(stream, "Missing initial stream");
  this.streams_.set(type, stream);
  log.info("Initial", type, stream);
```

with:

```ts
const { preferences } = this.player_.getConfig();
for (const [type, streams] of this.streamsMap_) {
  const matches = StreamUtils.findStreamsMatchingPreferences(
    type,
    streams,
    preferences,
  );
  const stream =
    matches?.[0] ?? this.streams_.get(type) ?? streams[0];
  asserts.assertExists(stream, "Missing initial stream");
  this.streams_.set(type, stream);
  log.info("Initial", type, stream);
```

This keeps behaviour equivalent to Task 1's state (first match wins) until
Task 4 introduces `resolveStream_` with bandwidth anchoring.

- [ ] **Step 2.5: Run tests**

Run: `pnpm --filter cmaf-lite test -- stream_utils`
Expected: PASS — all the new tests green.

Run: `pnpm tsc && pnpm test`
Expected: all pass (no callers left referencing the old name).

- [ ] **Step 2.6: Commit**

```bash
git add packages/cmaf-lite/lib/utils/stream_utils.ts \
        packages/cmaf-lite/lib/media/stream_controller.ts \
        packages/cmaf-lite/test/utils/stream_utils.test.ts
git commit -m "Rename findBestSuitableStream to findStreamsMatchingPreferences"
```

---

## Task 3: Add `pickClosestByBandwidth`

**Files:**

- Modify: `packages/cmaf-lite/lib/utils/stream_utils.ts`
- Modify: `packages/cmaf-lite/test/utils/stream_utils.test.ts`

- [ ] **Step 3.1: Write failing tests for `pickClosestByBandwidth`**

Edit `packages/cmaf-lite/test/utils/stream_utils.test.ts`. Add a new
`describe` block. Update the import line to also import
`pickClosestByBandwidth`:

```ts
import {
  buildStreams,
  findStreamsMatchingPreferences,
  pickClosestByBandwidth,
} from "../../lib/utils/stream_utils";
import type { VideoStream } from "../../lib/types/media";
```

Add below the `findStreamsMatchingPreferences` describe block:

```ts
describe("pickClosestByBandwidth", () => {
  // Build distinct VideoStreams via the manifest factories. Each track
  // gets a slightly different width/height so `buildStreams` does not
  // dedupe them (dedup compares type + codec + resolution).
  const videoStreamsFor = (bandwidths: number[]): VideoStream[] => {
    const manifest = createManifest({
      switchingSets: [
        createVideoSwitchingSet({
          tracks: bandwidths.map((bandwidth, i) =>
            createVideoTrack({
              bandwidth,
              width: 1920 - i,
              height: 1080 - i,
            }),
          ),
        }),
      ],
    });
    const list = buildStreams(manifest).get(MediaType.VIDEO) ?? [];
    return list.filter(
      (s): s is VideoStream => s.type === MediaType.VIDEO,
    );
  };

  it("returns the match whose bandwidth is closest to the active stream", () => {
    const matches = videoStreamsFor([500_000, 2_000_000, 5_000_000]);
    const active = matches[1]!;
    const result = pickClosestByBandwidth(matches, active);
    expect(result.bandwidth).toBe(2_000_000);
  });

  it("keeps the earlier entry when two matches tie on distance", () => {
    // matches ascending: [1_000_000, 3_000_000]; active is midpoint 2_000_000.
    // Distance ties → stable iteration keeps the earlier entry (1M).
    const matches = videoStreamsFor([1_000_000, 3_000_000]);
    const active = videoStreamsFor([2_000_000])[0]!;
    const result = pickClosestByBandwidth(matches, active);
    expect(result.bandwidth).toBe(1_000_000);
  });

  it("returns the sole match when the set has a single entry", () => {
    const matches = videoStreamsFor([2_500_000]);
    const active = videoStreamsFor([9_999_000])[0]!;
    const result = pickClosestByBandwidth(matches, active);
    expect(result.bandwidth).toBe(2_500_000);
  });
});
```

- [ ] **Step 3.2: Verify tests fail**

Run: `pnpm --filter cmaf-lite test -- stream_utils`
Expected: FAIL — `pickClosestByBandwidth` is not exported.

- [ ] **Step 3.3: Implement `pickClosestByBandwidth`**

Edit `packages/cmaf-lite/lib/utils/stream_utils.ts`. Add the following near
the bottom of the file (above or below `matchesPreference`, caller's
choice):

```ts
/**
 * Pick the stream in `matches` whose bandwidth is closest to
 * `activeStream.bandwidth`. Ties are broken by iteration order — the
 * first match wins, which in practice means the lower-bandwidth stream
 * when `matches` is sorted ascending (see `buildStreams`).
 */
export function pickClosestByBandwidth(
  matches: VideoStream[],
  activeStream: VideoStream,
): VideoStream {
  asserts.assertExists(matches[0], "pickClosestByBandwidth requires a non-empty list");
  let best = matches[0];
  let bestDelta = Math.abs(best.bandwidth - activeStream.bandwidth);
  for (let i = 1; i < matches.length; i++) {
    const candidate = matches[i]!;
    const delta = Math.abs(candidate.bandwidth - activeStream.bandwidth);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}
```

Also update the top-of-file import so `VideoStream` is available:

```ts
import type { Manifest, SwitchingSet, Track } from "../types/manifest";
import type { Preference, Stream, VideoStream } from "../types/media";
import { MediaType } from "../types/media";
```

- [ ] **Step 3.4: Run tests**

Run: `pnpm --filter cmaf-lite test -- stream_utils`
Expected: PASS on all three new tests.

Run: `pnpm tsc`
Expected: pass.

- [ ] **Step 3.5: Commit**

```bash
git add packages/cmaf-lite/lib/utils/stream_utils.ts \
        packages/cmaf-lite/test/utils/stream_utils.test.ts
git commit -m "Add pickClosestByBandwidth helper"
```

---

## Task 4: Add `resolveStream_` and wire from `tryStart_`

**Files:**

- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts`

- [ ] **Step 4.1: Add `resolveStream_` method**

Edit `packages/cmaf-lite/lib/media/stream_controller.ts`. Add a new private
method on the `StreamController` class, placed near `tryStart_`:

```ts
private resolveStream_<T extends MediaType>(
  type: T,
  streams: Stream<T>[],
): Stream<T> {
  const { preferences } = this.player_.getConfig();
  const matches = StreamUtils.findStreamsMatchingPreferences(
    type,
    streams,
    preferences,
  );
  const activeStream = this.streams_.get(type);

  if (matches) {
    if (type === MediaType.VIDEO && activeStream) {
      return StreamUtils.pickClosestByBandwidth(matches, activeStream);
    }
    return matches[0]!;
  }
  return activeStream ?? streams[0]!;
}
```

Note: this follows the user's preference to rely on narrowing rather than
`as` casts. If the compiler can't fully narrow `matches` / `activeStream`
to `VideoStream` inside the `type === VIDEO` branch, fix manually — do not
introduce `as` casts.

- [ ] **Step 4.2: Replace the inline selection in `tryStart_` with a `resolveStream_` call**

Edit `packages/cmaf-lite/lib/media/stream_controller.ts`. Replace the block
installed by Task 2:

```ts
const { preferences } = this.player_.getConfig();
for (const [type, streams] of this.streamsMap_) {
  const matches = StreamUtils.findStreamsMatchingPreferences(
    type,
    streams,
    preferences,
  );
  const stream =
    matches?.[0] ?? this.streams_.get(type) ?? streams[0];
  asserts.assertExists(stream, "Missing initial stream");
  this.streams_.set(type, stream);
  log.info("Initial", type, stream);
```

with:

```ts
for (const [type, streams] of this.streamsMap_) {
  const stream = this.resolveStream_(type, streams);
  this.streams_.set(type, stream);
  log.info("Initial", type, stream);
```

This drops the local `preferences` binding (now read inside `resolveStream_`)
and the `assertExists` — the new method's return type is `Stream<T>`, not
nullable.

- [ ] **Step 4.3: Run typecheck and tests**

Run: `pnpm tsc`
Expected: pass.

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 4.4: Manual smoke in the demo app**

Run: `pnpm dev`
Expected: demo app loads, video plays. No console errors referencing missing
streams or undefined preferences.

Why: there is no `stream_controller.test.ts` yet (see spec section 4). The
demo app is the end-to-end validation for this change.

- [ ] **Step 4.5: Commit**

```bash
git add packages/cmaf-lite/lib/media/stream_controller.ts
git commit -m "Add resolveStream_ and use it for initial stream selection"
```

---

## Task 5: Final verification

- [ ] **Step 5.1: Run the full workspace checks**

Run: `pnpm tsc && pnpm test && pnpm format`
Expected: typecheck clean, tests all pass, no formatter changes.

- [ ] **Step 5.2: Review the branch diff**

Run: `git diff main...HEAD --stat`
Expected changes:

- `packages/cmaf-lite/lib/types/media.ts` — `height` removed from
  `VideoPreference`.
- `packages/cmaf-lite/lib/utils/stream_utils.ts` — `findBestSuitableStream`
  renamed to `findStreamsMatchingPreferences` (returns `Stream<T>[] | null`);
  `pickWithinTier` deleted; `pickClosestByBandwidth` added.
- `packages/cmaf-lite/lib/media/stream_controller.ts` — `resolveStream_`
  added; `tryStart_` calls it.
- `packages/cmaf-lite/test/utils/stream_utils.test.ts` — new tests for
  `findStreamsMatchingPreferences` and `pickClosestByBandwidth`.

Confirm no unrelated churn (e.g. demo `VideoPreferenceForm` should be
untouched — see spec "Out of scope").

- [ ] **Step 5.3: Commit any formatter fixups if produced**

Only if `pnpm format` modified files:

```bash
git add -u
git commit -m "Apply formatter fixups"
```
