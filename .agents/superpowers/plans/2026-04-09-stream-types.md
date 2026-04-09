# Stream Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define public Stream/StreamPreference types and a stream selection utility, then wire them into StreamController and Player to enable querying available streams and setting playback preferences.

**Architecture:** New `types/player.ts` defines `Stream` (discriminated union) and `StreamPreference` (derived partial). New `utils/stream_select.ts` provides pure functions for building the stream list (intersected across presentations) and selecting tracks. StreamController delegates all track resolution to `stream_select.ts`. Player exposes `getStreams()` and `setPreference()`.

**Tech Stack:** TypeScript, Biome

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/types/player.ts` | Create | `Stream`, `StreamPreference` types |
| `lib/types/index.ts` | Modify | Re-export `types/player.ts` |
| `lib/utils/stream_select.ts` | Create | `getStreams`, `selectTrack` pure functions |
| `lib/utils/codec.ts` | Modify | Add `getContentType` for MSE content type from `MediaType` + `codec` |
| `lib/events.ts` | Modify | Add `STREAM_PREFERENCE_CHANGED` event |
| `lib/player.ts` | Modify | Add `getStreams()`, `setPreference()` |
| `lib/controllers/stream_controller.ts` | Modify | Replace `getTrackForType_` with `selectTrack`, add preferences map, handle preference event |
| `lib/controllers/buffer_controller.ts` | Modify | Add `flush(type)` method |

---

### Task 1: Stream and StreamPreference types

**Files:**
- Create: `lib/types/player.ts`
- Modify: `lib/types/index.ts`

- [ ] **Step 1: Create `types/player.ts`**

```typescript
import type { MediaType } from "./media";

export type Stream = {
  codec: string;
} & (
  | { type: MediaType.VIDEO; width: number; height: number }
  | { type: MediaType.AUDIO }
);

export type StreamPreference = {
  [K in Stream as K["type"]]: { type: K["type"] } & Partial<Omit<K, "type">>;
}[Stream["type"]];
```

- [ ] **Step 2: Re-export from `types/index.ts`**

Add to `lib/types/index.ts`:

```typescript
export * from "./player";
```

- [ ] **Step 3: Type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/types/player.ts lib/types/index.ts
git commit -m "feat: add Stream and StreamPreference types"
```

---

### Task 2: MSE content type utility

**Files:**
- Modify: `lib/utils/codec.ts`

- [ ] **Step 1: Add `getContentType` to `utils/codec.ts`**

The existing `getMimeType` takes `mimeType` + `codec` strings from `SwitchingSet`. The new function builds the MSE content type from `MediaType` + `codec` directly, since CMAF guarantees fMP4.

```typescript
import type { MediaType } from "../types";

export function getContentType(type: MediaType, codec: string) {
  return `${type}/mp4; codecs="${codec}"`;
}
```

Note: `MediaType.VIDEO` = `"video"`, `MediaType.AUDIO` = `"audio"`, so `${type}/mp4` produces `video/mp4` or `audio/mp4`.

- [ ] **Step 2: Type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/codec.ts
git commit -m "feat: add getContentType utility for MSE content type"
```

---

### Task 3: Stream selection utilities

**Files:**
- Create: `lib/utils/stream_select.ts`

This is the core logic. Two exported functions:

1. `getStreams(manifest)` — intersects streams across all presentations
2. `selectTrack(manifest, presentation, type, preference?)` — resolves a track for StreamController

- [ ] **Step 1: Create `utils/stream_select.ts`**

```typescript
import type {
  Manifest,
  MediaType,
  Presentation,
  Stream,
  StreamPreference,
  Track,
} from "../types";
import { assert, assertNotVoid } from "./assert";

/**
 * Derive the set of streams available across all
 * presentations. Only streams present in every
 * presentation are included (intersection).
 */
export function getStreams(manifest: Manifest): Stream[] {
  const sets = manifest.presentations.map(collectStreams);
  const result = sets.reduce(intersect);
  assert(result.length > 0, "No consistent streams across presentations");
  return result;
}

/**
 * Select the best track for a media type in a
 * presentation. With a preference, matches the closest
 * stream then resolves to a track. Without, returns
 * the first track.
 */
export function selectTrack(
  manifest: Manifest,
  presentation: Presentation,
  type: MediaType,
  preference?: StreamPreference,
): Track {
  if (!preference) {
    return getFirstTrack(presentation, type);
  }

  const streams = getStreams(manifest);
  const filtered = streams.filter(
    (s): s is Stream & { type: typeof type } => s.type === type,
  );
  const stream = matchPreference(filtered, preference);
  return resolveTrack(presentation, type, stream);
}

function collectStreams(presentation: Presentation): Stream[] {
  const streams: Stream[] = [];
  for (const selectionSet of presentation.selectionSets) {
    for (const switchingSet of selectionSet.switchingSets) {
      for (const track of switchingSet.tracks) {
        const stream = toStream(track, switchingSet.codec);
        if (!streams.some((s) => isSameStream(s, stream))) {
          streams.push(stream);
        }
      }
    }
  }
  return streams;
}

function toStream(track: Track, codec: string): Stream {
  if (track.type === "video") {
    return {
      type: track.type,
      codec,
      width: track.width,
      height: track.height,
    };
  }
  return { type: track.type, codec };
}

function isSameStream(a: Stream, b: Stream): boolean {
  if (a.type !== b.type || a.codec !== b.codec) {
    return false;
  }
  if (a.type === "video" && b.type === "video") {
    return a.width === b.width && a.height === b.height;
  }
  return true;
}

function intersect(a: Stream[], b: Stream[]): Stream[] {
  return a.filter((s) => b.some((t) => isSameStream(s, t)));
}

/**
 * Match a preference to the closest stream. For video,
 * closest by height, then width. For audio, first match
 * by codec or first available.
 */
function matchPreference(
  streams: Stream[],
  preference: StreamPreference,
): Stream {
  assertNotVoid(streams[0], "No streams to match against");

  if (preference.type === "video") {
    return matchVideoPreference(
      streams as (Stream & { type: "video" })[],
      preference,
    );
  }

  return matchAudioPreference(
    streams as (Stream & { type: "audio" })[],
    preference,
  );
}

function matchVideoPreference(
  streams: (Stream & { type: "video" })[],
  preference: { type: "video"; codec?: string; width?: number; height?: number },
): Stream {
  let best = streams[0];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const stream of streams) {
    let dist = 0;
    if (preference.height !== undefined) {
      dist += Math.abs(stream.height - preference.height);
    }
    if (preference.width !== undefined) {
      dist += Math.abs(stream.width - preference.width);
    }
    if (preference.codec !== undefined && stream.codec !== preference.codec) {
      dist += 1_000_000;
    }
    if (dist < bestDist) {
      best = stream;
      bestDist = dist;
    }
  }

  return best;
}

function matchAudioPreference(
  streams: (Stream & { type: "audio" })[],
  preference: { type: "audio"; codec?: string },
): Stream {
  if (preference.codec) {
    const match = streams.find((s) => s.codec === preference.codec);
    if (match) {
      return match;
    }
  }
  return streams[0];
}

function resolveTrack(
  presentation: Presentation,
  type: MediaType,
  stream: Stream,
): Track {
  for (const selectionSet of presentation.selectionSets) {
    if (selectionSet.type !== type) {
      continue;
    }
    for (const switchingSet of selectionSet.switchingSets) {
      if (switchingSet.codec !== stream.codec) {
        continue;
      }
      for (const track of switchingSet.tracks) {
        if (isTrackMatch(track, stream)) {
          return track;
        }
      }
    }
  }

  throw new Error(
    `No track found for stream in presentation`,
  );
}

function isTrackMatch(track: Track, stream: Stream): boolean {
  if (track.type !== stream.type) {
    return false;
  }
  if (track.type === "video" && stream.type === "video") {
    return track.width === stream.width && track.height === stream.height;
  }
  return true;
}

function getFirstTrack(presentation: Presentation, type: MediaType): Track {
  const selectionSet = presentation.selectionSets.find(
    (s) => s.type === type,
  );
  assertNotVoid(selectionSet, `No SelectionSet for ${type}`);

  const switchingSet = selectionSet.switchingSets[0];
  assertNotVoid(switchingSet, "No SwitchingSet");

  const track = switchingSet.tracks[0];
  assertNotVoid(track, "No Track");

  return track;
}
```

- [ ] **Step 2: Type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/stream_select.ts
git commit -m "feat: add stream selection utilities"
```

---

### Task 4: STREAM_PREFERENCE_CHANGED event

**Files:**
- Modify: `lib/events.ts`

- [ ] **Step 1: Add event to `events.ts`**

Add the event key to the `Events` object:

```typescript
STREAM_PREFERENCE_CHANGED: "streamPreferenceChanged",
```

Add the event type:

```typescript
export type StreamPreferenceChangedEvent = {
  preference: StreamPreference;
};
```

Add the import of `StreamPreference`:

```typescript
import type { StreamPreference } from "./types";
```

Add to `EventMap`:

```typescript
[Events.STREAM_PREFERENCE_CHANGED]: (event: StreamPreferenceChangedEvent) => void;
```

- [ ] **Step 2: Type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/events.ts
git commit -m "feat: add STREAM_PREFERENCE_CHANGED event"
```

---

### Task 5: BufferController flush method

**Files:**
- Modify: `lib/controllers/buffer_controller.ts`

- [ ] **Step 1: Add `flush` method to BufferController**

Add a public method that clears the SourceBuffer for a given media type via the operation queue:

```typescript
flush(type: MediaType) {
  const sb = this.sourceBuffers_.get(type);
  if (!sb || sb.buffered.length === 0) {
    return;
  }
  this.opQueue_.enqueue(type, {
    execute: () => {
      sb.remove(0, Infinity);
    },
  });
}
```

- [ ] **Step 2: Type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/buffer_controller.ts
git commit -m "feat: add flush method to BufferController"
```

---

### Task 6: StreamController — use selectTrack and handle preferences

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

This task replaces `getTrackForType_` with `selectTrack`, adds preference storage, and handles the `STREAM_PREFERENCE_CHANGED` event.

- [ ] **Step 1: Add imports and preference state**

Add imports at the top:

```typescript
import type { StreamPreferenceChangedEvent } from "../events";
import type { StreamPreference } from "../types";
import { getStreams, selectTrack } from "../utils/stream_select";
import { getContentType } from "../utils/codec";
```

Add preference map to class fields:

```typescript
private preferences_ = new Map<MediaType, StreamPreference>();
```

- [ ] **Step 2: Register and unregister STREAM_PREFERENCE_CHANGED**

In constructor, add:

```typescript
this.player_.on(Events.STREAM_PREFERENCE_CHANGED, this.onStreamPreferenceChanged_);
```

In `destroy()`, add:

```typescript
this.player_.off(Events.STREAM_PREFERENCE_CHANGED, this.onStreamPreferenceChanged_);
```

- [ ] **Step 3: Add preference changed handler**

```typescript
private onStreamPreferenceChanged_ = (event: StreamPreferenceChangedEvent) => {
  const { preference } = event;
  this.preferences_.set(preference.type, preference);

  const mediaState = this.mediaStates_.get(preference.type);
  if (!mediaState || !this.manifest_) {
    return;
  }

  if (mediaState.lastRequest) {
    this.networkService_.cancel(mediaState.lastRequest);
  }

  mediaState.track = selectTrack(
    this.manifest_,
    mediaState.presentation,
    mediaState.type,
    preference,
  );
  mediaState.lastSegment = null;
  mediaState.lastInitSegment = null;
};
```

- [ ] **Step 4: Replace `tryStart_` track selection with `selectTrack`**

Replace the body of `tryStart_` to use `selectTrack` and `getContentType` instead of manually walking the manifest hierarchy. The `getMimeType` import can be removed.

Current code to replace in `tryStart_` (the for loop):

```typescript
for (const selectionSet of presentation.selectionSets) {
  const switchingSet = selectionSet.switchingSets[0];
  assertNotVoid(switchingSet, "No SwitchingSet available");

  const track = switchingSet.tracks[0];
  assertNotVoid(track, "No Track available");

  const type = selectionSet.type;

  const mediaState: MediaState = {
    type,
    ended: false,
    presentation,
    track,
    lastSegment: null,
    lastInitSegment: null,
    lastRequest: null,
    timer: new Timer(() => this.update_(mediaState)),
  };

  this.mediaStates_.set(type, mediaState);
  mediaTracks.set(type, {
    type,
    mimeType: getMimeType(switchingSet.mimeType, switchingSet.codec),
  });
}
```

Replace with:

```typescript
const streams = getStreams(this.manifest_);
const types = new Set(streams.map((s) => s.type));

for (const type of types) {
  const preference = this.preferences_.get(type);
  const track = selectTrack(this.manifest_, presentation, type, preference);
  const stream = streams.find((s) => s.type === type);
  assertNotVoid(stream, `No stream for ${type}`);

  const mediaState: MediaState = {
    type,
    ended: false,
    presentation,
    track,
    lastSegment: null,
    lastInitSegment: null,
    lastRequest: null,
    timer: new Timer(() => this.update_(mediaState)),
  };

  this.mediaStates_.set(type, mediaState);
  mediaTracks.set(type, {
    type,
    mimeType: getContentType(type, stream.codec),
  });
}
```

- [ ] **Step 5: Replace `advanceOrEnd_` track resolution**

Replace the line in `advanceOrEnd_`:

```typescript
mediaState.track = this.getTrackForType_(presentation, mediaState.type);
```

With:

```typescript
mediaState.track = selectTrack(
  this.manifest_!,
  presentation,
  mediaState.type,
  this.preferences_.get(mediaState.type),
);
```

- [ ] **Step 6: Remove `getTrackForType_` method**

Delete the entire `getTrackForType_` method (lines 275-288).

- [ ] **Step 7: Clean up unused imports**

Remove the `getMimeType` import from `../utils/codec`. Remove `SelectionSet` and `SwitchingSet` from imports if no longer used. Keep `Manifest`, `Presentation`, `Track`, and other types still referenced.

- [ ] **Step 8: Type check and format**

Run: `pnpm tsc && pnpm format`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: use selectTrack for all track resolution in StreamController"
```

---

### Task 7: Player API — getStreams and setPreference

**Files:**
- Modify: `lib/player.ts`

- [ ] **Step 1: Add imports**

```typescript
import type { StreamPreference } from "./types";
import { getStreams } from "./utils/stream_select";
```

- [ ] **Step 2: Add `getStreams` method**

```typescript
getStreams() {
  return this.manifest_ ? getStreams(this.manifest_) : [];
}
```

This requires the player to have access to the manifest. Add a `manifest_` field:

```typescript
private manifest_: Manifest | null = null;
```

Listen for `MANIFEST_PARSED` to store it:

```typescript
constructor() {
  super();
  // ... existing code ...
  this.on(Events.MANIFEST_PARSED, (event) => {
    this.manifest_ = event.manifest;
  });
}
```

Add the import:

```typescript
import type { Manifest } from "./types";
```

- [ ] **Step 3: Add `setPreference` method**

```typescript
setPreference(preference: StreamPreference, flushBuffer?: boolean) {
  this.emit(Events.STREAM_PREFERENCE_CHANGED, { preference });
  if (flushBuffer) {
    this.bufferController_.flush(preference.type);
  }
}
```

- [ ] **Step 4: Type check and format**

Run: `pnpm tsc && pnpm format`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add lib/player.ts
git commit -m "feat: add getStreams and setPreference to Player"
```

---

### Task 8: Export public types and verify

**Files:**
- Modify: `lib/index.ts`

- [ ] **Step 1: Verify `Stream` and `StreamPreference` are exported**

Since `types/index.ts` already re-exports `types/player.ts` (Task 1), and `lib/index.ts` already exports `./types`, `Stream` and `StreamPreference` should be available from the package root. Verify by checking `pnpm tsc` passes.

Also export the `STREAM_PREFERENCE_CHANGED` event — it's already part of `Events` which is exported via `./events`.

- [ ] **Step 2: Full build**

Run: `pnpm build`
Expected: Clean build, no errors.

- [ ] **Step 3: Format**

Run: `pnpm format`
Expected: No formatting issues.

- [ ] **Step 4: Commit (if any formatting changes)**

```bash
git add -A
git commit -m "chore: format and verify build"
```
