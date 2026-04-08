# EOS Detection & StreamController Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix end-of-stream detection and presentation advancement in StreamController, plus slim down MediaState.

**Architecture:** Four targeted changes to `stream_controller.ts`: slim MediaState (remove cached intermediates, add `type`), make `getPresentationForTime_` gap-tolerant, add presentation advancement on segment exhaustion, add EOS detection for the seek path.

**Tech Stack:** TypeScript

---

### Task 1: Slim MediaState and update tryStart_()

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Update MediaState type and imports**

Remove `selectionSet` and `switchingSet` from the type. Add `type`. Remove unused imports.

```typescript
import type {
  BufferAppendedEvent,
  BufferCreatedEvent,
  ManifestParsedEvent,
  MediaAttachedEvent,
} from "../events";
import { Events } from "../events";
import type { Player } from "../player";
import type {
  InitSegment,
  Manifest,
  MediaType,
  Presentation,
  Segment,
  SwitchingSet,
  Track,
} from "../types/manifest";
```

```typescript
type MediaState = {
  state: State;
  type: MediaType;
  request: Request<"arraybuffer"> | null;
  presentation: Presentation;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  timer: Timer;
};
```

- [ ] **Step 2: Update tryStart_() to use new MediaState**

Replace the MediaState construction. Walk selectionSet/switchingSet locally without storing them.

```typescript
private tryStart_() {
  if (!this.manifest_ || !this.media_) {
    return;
  }

  const presentation = this.manifest_.presentations[0];
  assertNotVoid(presentation, "No Presentation found");

  const codecTracks = new Map<
    MediaType,
    { mimeType: string; codec: string }
  >();

  for (const selectionSet of presentation.selectionSets) {
    const switchingSet = selectionSet.switchingSets[0];
    assertNotVoid(switchingSet, "No SwitchingSet available");

    const track = switchingSet.tracks[0];
    assertNotVoid(track, "No Track available");

    const type = selectionSet.type;

    const mediaState: MediaState = {
      state: State.IDLE,
      type,
      request: null,
      presentation,
      track,
      lastSegment: null,
      lastInitSegment: null,
      timer: new Timer(() => this.onUpdate_(mediaState)),
    };

    this.mediaStates_.set(type, mediaState);

    codecTracks.set(type, {
      mimeType: switchingSet.mimeType,
      codec: switchingSet.codec,
    });
  }

  this.player_.emit(Events.BUFFER_CODECS, {
    tracks: codecTracks,
    duration: this.computeDuration_(),
  });

  for (const mediaState of this.mediaStates_.values()) {
    mediaState.timer.tickEvery(TICK_INTERVAL);
  }
}
```

- [ ] **Step 3: Update update_() to read type from mediaState**

Replace `mediaState.selectionSet.type` with `mediaState.type`:

```typescript
private update_(mediaState: MediaState) {
  if (mediaState.state !== State.IDLE || mediaState.request) {
    return;
  }
  if (!this.media_) {
    return;
  }

  const currentTime = this.media_.currentTime;
  const bufferGoal = this.player_.getConfig().bufferGoal;
  const bufferEnd = this.getBufferEnd_(mediaState.type, currentTime);

  if (bufferEnd !== null && bufferEnd - currentTime >= bufferGoal) {
    return;
  }

  if (bufferEnd === null) {
    mediaState.lastSegment = null;
  }

  const lookupTime = bufferEnd ?? currentTime;

  if (!this.resolvePresentation_(mediaState, lookupTime)) {
    return;
  }

  if (mediaState.track.initSegment !== mediaState.lastInitSegment) {
    this.loadInitSegment_(mediaState);
    return;
  }

  const segment = mediaState.lastSegment
    ? this.getNextSegment_(mediaState)
    : this.getSegmentForTime_(mediaState.track, lookupTime);

  if (segment) {
    this.loadSegment_(mediaState, segment);
    return;
  }

  this.checkEndOfStream_();
}
```

- [ ] **Step 4: Update loadInitSegment_() and loadSegment_()**

Replace `mediaState.selectionSet.type` with `mediaState.type`:

In `loadInitSegment_`:
```typescript
private async loadInitSegment_(mediaState: MediaState) {
  const { initSegment } = mediaState.track;

  if (mediaState.lastInitSegment === initSegment) {
    return;
  }

  const request = new Request(initSegment.url, "arraybuffer");
  mediaState.request = request;

  try {
    const data = await request.response;

    if (mediaState.request !== request) {
      return;
    }

    mediaState.lastInitSegment = initSegment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment,
      data,
      segment: null,
    });
  } catch (error) {
    if (mediaState.request !== request) {
      return;
    }
    mediaState.request = null;

    if (error instanceof DOMException && error.name === "AbortError") {
      this.player_.emit(Events.ERROR, {
        error: {
          code: ErrorCode.SEGMENT_CANCELLED,
          fatal: false,
          data: { url: initSegment.url, mediaType: mediaState.type },
        },
      });
      return;
    }

    this.player_.emit(Events.ERROR, {
      error: {
        code: ErrorCode.SEGMENT_LOAD_FAILED,
        fatal: true,
        data: {
          url: initSegment.url,
          mediaType: mediaState.type,
          status: null,
        },
      },
    });
  }
}
```

In `loadSegment_`:
```typescript
private async loadSegment_(mediaState: MediaState, segment: Segment) {
  const request = new Request(segment.url, "arraybuffer");
  mediaState.request = request;
  mediaState.lastSegment = segment;

  try {
    const data = await request.response;

    if (mediaState.request !== request) {
      return;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment: mediaState.track.initSegment,
      segment,
      data,
    });
  } catch (error) {
    if (mediaState.request !== request) {
      return;
    }
    mediaState.request = null;

    if (error instanceof DOMException && error.name === "AbortError") {
      this.player_.emit(Events.ERROR, {
        error: {
          code: ErrorCode.SEGMENT_CANCELLED,
          fatal: false,
          data: { url: segment.url, mediaType: mediaState.type },
        },
      });
      return;
    }

    this.player_.emit(Events.ERROR, {
      error: {
        code: ErrorCode.SEGMENT_LOAD_FAILED,
        fatal: true,
        data: {
          url: segment.url,
          mediaType: mediaState.type,
          status: null,
        },
      },
    });
  }
}
```

- [ ] **Step 5: Verify build**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 6: Run format**

Run: `pnpm format`

- [ ] **Step 7: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: slim MediaState by removing cached intermediates"
```

---

### Task 2: Simplify resolvePresentation_()

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Update resolvePresentation_()**

Remove selectionSet/switchingSet storage. Walk from presentation inline, store only track.

```typescript
/**
 * Resolve the presentation chain for the given
 * time. Updates presentation and track when
 * the presentation changes.
 */
private resolvePresentation_(mediaState: MediaState, time: number): boolean {
  if (!this.manifest_) {
    return false;
  }

  const presentation = this.getPresentationForTime_(time);
  if (!presentation) {
    mediaState.state = State.ENDED;
    this.checkEndOfStream_();
    return false;
  }

  if (presentation === mediaState.presentation) {
    return true;
  }

  const selectionSet = presentation.selectionSets.find(
    (s) => s.type === mediaState.type,
  );
  assertNotVoid(selectionSet, `No SelectionSet for ${mediaState.type} in Presentation`);

  const switchingSet = selectionSet.switchingSets[0];
  assertNotVoid(switchingSet, "No SwitchingSet in Presentation");

  const track = switchingSet.tracks[0];
  assertNotVoid(track, "No Track in Presentation");

  mediaState.presentation = presentation;
  mediaState.track = track;
  mediaState.lastSegment = null;

  return true;
}
```

- [ ] **Step 2: Remove unused SelectionSet and SwitchingSet imports**

Update the import block — remove `SelectionSet` if no longer used anywhere:

```typescript
import type {
  InitSegment,
  Manifest,
  MediaType,
  Presentation,
  Segment,
  Track,
} from "../types/manifest";
```

- [ ] **Step 3: Verify build**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: simplify resolvePresentation_ to only update track"
```

---

### Task 3: Make getPresentationForTime_() gap-tolerant

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Simplify the lookup**

Replace the existing range check with a forward-scan that returns the first presentation whose end is past the given time. This handles gaps between presentations and float-precision at boundaries.

```typescript
/**
 * Find the presentation for the given time.
 * Returns the first presentation whose end is
 * past the time, which handles gaps between
 * presentations and float-precision at boundaries.
 */
private getPresentationForTime_(time: number): Presentation | null {
  if (!this.manifest_) {
    return null;
  }
  for (const p of this.manifest_.presentations) {
    if (time < p.end) {
      return p;
    }
  }
  return null;
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "fix: make getPresentationForTime_ gap-tolerant"
```

---

### Task 4: Add presentation advancement and EOS detection

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Update the null-segment handling in update_()**

Replace the current fallthrough at the end of `update_()`:

```typescript
if (segment) {
  this.loadSegment_(mediaState, segment);
  return;
}

this.checkEndOfStream_();
```

With:

```typescript
if (segment) {
  this.loadSegment_(mediaState, segment);
  return;
}

if (mediaState.lastSegment) {
  // Sequential path: all segments in current
  // presentation exhausted. Advance to the next
  // presentation by resolving at the boundary.
  this.resolvePresentation_(mediaState, mediaState.presentation.end);
  return;
}

// Seek path: no segment found at lookupTime.
// SourceBuffer.buffered has limited float precision,
// so bufferEnd may never exactly reach the duration.
// A microsecond tolerance (Shaka v2) prevents an
// infinite no-op loop when all content is buffered.
const duration = this.computeDuration_();
if (lookupTime >= duration - 1e-6) {
  mediaState.state = State.ENDED;
  this.checkEndOfStream_();
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm tsc`
Expected: No type errors.

- [ ] **Step 3: Run format**

Run: `pnpm format`

- [ ] **Step 4: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "fix: add presentation advancement and EOS detection"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Run dev server**

Run: `pnpm dev`

- [ ] **Step 2: Test multi-period playback**

Load a multi-period DASH manifest. Verify:
- Playback crosses presentation boundary without stalling
- Buffer continues filling into the second presentation
- `endOfStream()` fires when all content is buffered (check via `document.querySelector('video').mediaSource` or Network tab showing no more requests after final segment)

- [ ] **Step 3: Test seek across presentations**

Seek to a time in the second presentation. Verify segments load from the correct presentation.
