# Unified Stream Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduplicate stream selection logic in `StreamController` by extracting `switchStream_` and introducing a `STREAM_CHANGED` event.

**Architecture:** A single `switchStream_` method encapsulates stream-change detection, request cancellation, codec-change emission, state reset, and `STREAM_CHANGED` emission. `MediaState.stream` becomes nullable to represent the pre-initialization state. Both `tryStart_` and `setPreference` delegate to `switchStream_`.

**Tech Stack:** TypeScript, Vitest

**Spec:** `.agents/superpowers/specs/2026-04-14-unified-stream-switching-design.md`

---

### Task 1: Add `STREAM_CHANGED` event and `StreamChangedEvent` type

**Files:**
- Modify: `packages/cmaf-lite/lib/events.ts`

- [ ] **Step 1: Add the event constant**

In `Events` object, add after `BUFFER_FLUSHED`:

```ts
STREAM_CHANGED: "streamChanged",
```

- [ ] **Step 2: Add the event type**

After `BufferFlushedEvent`, add:

```ts
/**
 * Fired when the active stream changes for a media type.
 * `oldStream` is `null` on initial stream selection.
 *
 * @public
 */
export type StreamChangedEvent = {
  oldStream: Stream | null;
  stream: Stream;
};
```

Add `Stream` to the import from `"."`:

```ts
import type {
  InitSegment,
  Manifest,
  NetworkRequest,
  NetworkRequestType,
  NetworkResponse,
  Segment,
  SourceBufferMediaType,
  Stream,
} from ".";
```

- [ ] **Step 3: Add EventMap entry**

```ts
[Events.STREAM_CHANGED]: (event: StreamChangedEvent) => void;
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm tsc`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/events.ts
git commit -m "feat: add STREAM_CHANGED event type"
```

---

### Task 2: Make `MediaState.stream` nullable

**Files:**
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts`

- [ ] **Step 1: Update the `MediaState` type**

Change `stream` field:

```ts
type MediaState = {
  type: MediaType;
  stream: Stream | null;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  request: NetworkRequest | null;
  ended: boolean;
  timer: Timer;
};
```

- [ ] **Step 2: Update `getActiveStream`**

No change needed — it already reads from `mediaStates_` and uses `assertExists` pattern. But we need to add the null assert on the stream itself:

```ts
getActiveStream(type: MediaType) {
  const mediaState = this.mediaStates_.get(type);
  asserts.assertExists(mediaState, `No Media State for ${type}`);
  asserts.assertExists(mediaState.stream, `No Stream for ${type}`);
  return mediaState.stream;
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: Errors in `stream_controller.ts` where `mediaState.stream` is used without null checks (in `setPreference`, `update_`, `getNextSegment_`). These will be resolved in Task 3.

- [ ] **Step 4: Commit** (skip if tsc fails — combine with Task 3)

---

### Task 3: Extract `switchStream_` and refactor callers

**Files:**
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts`

- [ ] **Step 1: Add the `Events` import for `STREAM_CHANGED`**

The `Events` import already exists. No change needed — `STREAM_CHANGED` is on the same `Events` object.

- [ ] **Step 2: Add `switchStream_` method**

Add after `setPreference`:

```ts
/**
 * Applies a stream change to a media state. Returns `false`
 * if the stream is already active (no-op).
 */
private switchStream_(mediaState: MediaState, stream: Stream): boolean {
  const oldStream = mediaState.stream;
  if (stream === oldStream) {
    return false;
  }

  const networkService = this.player_.getNetworkService();
  if (mediaState.request) {
    networkService.cancel(mediaState.request);
  }

  if (
    !oldStream ||
    oldStream.hierarchy.switchingSet !== stream.hierarchy.switchingSet
  ) {
    if (isAV(mediaState.type)) {
      this.player_.emit(Events.BUFFER_CODECS, {
        type: mediaState.type,
        codec: stream.hierarchy.switchingSet.codec,
      });
    }
  }

  mediaState.stream = stream;
  mediaState.lastSegment = null;
  mediaState.lastInitSegment = null;

  log.info("Switched stream", stream);

  this.player_.emit(Events.STREAM_CHANGED, {
    oldStream,
    stream,
  });

  return true;
}
```

- [ ] **Step 3: Refactor `tryStart_`**

Replace the loop body (lines 172–196) with:

```ts
for (const [type, streams] of this.streams_) {
  const preference = this.preferences_.get(type) ?? { type };
  this.preferences_.set(type, preference);
  const stream = StreamUtils.selectStream(streams, preference);
  log.info(`Initial Stream ${type}`, stream);

  const mediaState: MediaState = {
    type,
    stream: null,
    ended: false,
    lastSegment: null,
    lastInitSegment: null,
    request: null,
    timer: new Timer(() => this.update_(mediaState)),
  };

  this.mediaStates_.set(type, mediaState);
  this.switchStream_(mediaState, stream);
}
```

- [ ] **Step 4: Refactor `setPreference`**

Replace lines 116–153 with:

```ts
const stream = StreamUtils.selectStream(streams, preference);
if (!this.switchStream_(mediaState, stream)) {
  return;
}

if (flushBuffer && isAV(mediaState.type)) {
  this.player_.emit(Events.BUFFER_FLUSHING, { type: mediaState.type });
}

this.update_(mediaState);
```

- [ ] **Step 5: Fix null safety in `update_` and `getNextSegment_`**

In `update_`, add early return at the top:

```ts
private update_(mediaState: MediaState) {
  if (!mediaState.stream) {
    return;
  }
  if (mediaState.ended || mediaState.request?.inFlight) {
    return;
  }
```

In `getNextSegment_`, add null guard:

```ts
private getNextSegment_(mediaState: MediaState): Segment | null {
  if (!mediaState.lastSegment || !mediaState.stream) {
    return null;
  }
```

In `isEnded_`, add null guard:

```ts
private isEnded_(mediaState: MediaState): boolean {
  if (!mediaState.lastSegment || !mediaState.stream) {
    return false;
  }
```

- [ ] **Step 6: Verify types compile**

Run: `pnpm tsc`
Expected: No errors

- [ ] **Step 7: Run existing tests**

Run: `pnpm test`
Expected: All existing tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/cmaf-lite/lib/media/stream_controller.ts
git commit -m "refactor: extract switchStream_ and unify stream change logic"
```

---

### Task 4: Add tests for `switchStream_` behavior

**Files:**
- Create: `packages/cmaf-lite/test/media/stream_controller.test.ts`
- Modify: `packages/cmaf-lite/test/__framework__/factories.ts`

- [ ] **Step 1: Add stream factory to test helpers**

In `packages/cmaf-lite/test/__framework__/factories.ts`, add:

```ts
import type { Stream, StreamHierarchy } from "../../lib/types/media";

export function createStreamHierarchy(
  overrides?: Partial<StreamHierarchy>,
): StreamHierarchy {
  const switchingSet = overrides?.switchingSet ?? createSwitchingSet();
  return {
    switchingSet,
    track: overrides?.track ?? switchingSet.tracks[0],
  };
}

export function createVideoStream(
  overrides?: Partial<Extract<Stream, { type: MediaType.VIDEO }>>,
): Extract<Stream, { type: MediaType.VIDEO }> {
  const hierarchy = overrides?.hierarchy ?? createStreamHierarchy();
  return {
    type: MediaType.VIDEO,
    codec: hierarchy.switchingSet.codec,
    bandwidth: 2_000_000,
    width: 1920,
    height: 1080,
    hierarchy,
    ...overrides,
  };
}

export function createAudioStream(
  overrides?: Partial<Extract<Stream, { type: MediaType.AUDIO }>>,
): Extract<Stream, { type: MediaType.AUDIO }> {
  const hierarchy = overrides?.hierarchy ??
    createStreamHierarchy({
      switchingSet: createSwitchingSet({
        type: MediaType.AUDIO,
        codec: "mp4a.40.2",
        tracks: [createAudioTrack()],
      }),
    });
  return {
    type: MediaType.AUDIO,
    codec: hierarchy.switchingSet.codec,
    bandwidth: 128_000,
    hierarchy,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write `StreamController` test scaffolding**

Create `packages/cmaf-lite/test/media/stream_controller.test.ts`. This test needs a `Player` instance. Check how the player is constructed — we need to understand the minimal setup. Read `lib/player.ts` to determine the constructor signature and what services `StreamController` depends on (event emitter, `getNetworkService`, `getConfig`, `getBuffered`).

Based on the player API, set up a minimal integration test that:
- Creates a `Player`
- Attaches media
- Loads a manifest
- Listens for events

- [ ] **Step 3: Test — initial stream selection emits `STREAM_CHANGED` with null `oldStream`**

```ts
it("emits STREAM_CHANGED with null oldStream on initial selection", () => {
  // Setup: create player, load manifest, attach media
  // Assert: STREAM_CHANGED fired for each media type
  // Assert: oldStream is null, stream matches expected selection
});
```

- [ ] **Step 4: Test — `setPreference` emits `STREAM_CHANGED` when stream changes**

```ts
it("emits STREAM_CHANGED with previous stream when preference changes stream", () => {
  // Setup: player loaded and attached, initial streams active
  // Act: setPreference with different bandwidth
  // Assert: STREAM_CHANGED fired with oldStream = previous, stream = new
});
```

- [ ] **Step 5: Test — `setPreference` does not emit `STREAM_CHANGED` when stream stays same**

```ts
it("does not emit STREAM_CHANGED when preference resolves to same stream", () => {
  // Setup: player loaded and attached
  // Act: setPreference that resolves to the same stream
  // Assert: STREAM_CHANGED not fired
});
```

- [ ] **Step 6: Test — `BUFFER_CODECS` emitted on switching set change**

```ts
it("emits BUFFER_CODECS when switching set changes", () => {
  // Setup: player loaded with multiple switching sets
  // Act: setPreference that moves to different switching set
  // Assert: BUFFER_CODECS fired with new codec
});
```

- [ ] **Step 7: Test — `BUFFER_CODECS` emitted on initial selection**

```ts
it("emits BUFFER_CODECS on initial stream selection", () => {
  // Setup: create player, listen for BUFFER_CODECS
  // Act: load manifest + attach media
  // Assert: BUFFER_CODECS fired for each AV type
});
```

- [ ] **Step 8: Run tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add packages/cmaf-lite/test/__framework__/factories.ts packages/cmaf-lite/test/media/stream_controller.test.ts
git commit -m "test: add StreamController stream switching tests"
```

---

### Task 5: Format and final verification

**Files:**
- All modified files

- [ ] **Step 1: Format**

Run: `pnpm format`

- [ ] **Step 2: Type check**

Run: `pnpm tsc`
Expected: No errors

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Commit any format fixes**

```bash
git add -u
git commit -m "chore: format"
```
