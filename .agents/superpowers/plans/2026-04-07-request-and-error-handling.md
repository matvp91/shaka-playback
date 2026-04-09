# Request & Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a cancellable `Request<T>` class, a type-safe error system, and wire them through all network call sites so in-flight fetches can be aborted on seek or destroy.

**Architecture:** A generic `Request<T>` wraps `fetch` with an internal `AbortController`. A discriminated `PlayerError` union with `ErrorCode` provides type-safe error data. Controllers catch request failures, map them to `PlayerError`, and emit `Events.ERROR`.

**Tech Stack:** TypeScript, native `fetch`, native `AbortController`

---

### Task 1: Create `Request<T>` class

**Files:**
- Create: `lib/utils/request.ts`

- [ ] **Step 1: Create `Request<T>` with type-safe responses and cancellation**

```typescript
type ResponseTypeMap = {
  text: string;
  arraybuffer: ArrayBuffer;
};

export class Request<T extends keyof ResponseTypeMap> {
  readonly response: Promise<ResponseTypeMap[T]>;

  private controller_ = new AbortController();

  constructor(url: string, responseType: T) {
    this.response = this.fetch_(url, responseType);
  }

  cancel() {
    this.controller_.abort();
  }

  private async fetch_(
    url: string,
    responseType: T,
  ): Promise<ResponseTypeMap[T]> {
    const response = await fetch(url, {
      signal: this.controller_.signal,
    });
    if (responseType === "text") {
      return (await response.text()) as ResponseTypeMap[T];
    }
    return (await response.arrayBuffer()) as ResponseTypeMap[T];
  }
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: PASS — no type errors

- [ ] **Step 3: Commit**

```
feat: add Request<T> class with type-safe responses and cancellation
```

---

### Task 2: Create error system

**Files:**
- Create: `lib/errors.ts`
- Modify: `lib/events.ts`

- [ ] **Step 1: Create `lib/errors.ts` with error codes, data map, and PlayerError type**

```typescript
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
```

- [ ] **Step 2: Add ERROR event to `lib/events.ts`**

Add the import at the top of `lib/events.ts`:

```typescript
import type { PlayerError } from "./errors";
```

Add the event type:

```typescript
export type ErrorEvent = {
  error: PlayerError;
};
```

Add to `Events` object:

```typescript
ERROR: "error",
```

Add to `EventMap`:

```typescript
[Events.ERROR]: (event: ErrorEvent) => void;
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat: add type-safe error system and ERROR event
```

---

### Task 3: Wire `Request` into ManifestController

**Files:**
- Modify: `lib/controllers/manifest_controller.ts`
- Modify: `lib/dash/dash_parser.ts`

The `fetchManifest` function in `dash_parser.ts` currently does its own `fetch`. We need to split this: the parser should only parse, and the controller should own the `Request`.

- [ ] **Step 1: Remove `fetchManifest` from `dash_parser.ts` and export `parseManifest` directly**

In `lib/dash/dash_parser.ts`, remove the `fetchManifest` function (lines 33-39). Make `parseManifest` a public export by changing `async function parseManifest` to `export async function parseManifest`. Remove the `ParseManifestOptions` type (line 41-43) — fold `sourceUrl` into `parseManifest`'s signature directly:

```typescript
export async function parseManifest(
  text: string,
  sourceUrl: string,
) {
```

Update the internal usage: replace `options.sourceUrl` with `sourceUrl` at line 181:

```typescript
const baseUrl = resolveUrls([sourceUrl, ...baseUrls]);
```

And update the call at line 57 — `parsePeriod` needs `sourceUrl` instead of `options`:

Change `parsePeriod(options, mpd, period, periodIndex)` to `parsePeriod(sourceUrl, mpd, period, periodIndex)`.

Update `parsePeriod` signature and all downstream functions (`parseSelectionSet`, `parseSwitchingSet`, `parseTrack`) to accept `sourceUrl: string` instead of `options: ParseManifestOptions`, threading the string through.

- [ ] **Step 2: Update ManifestController to use `Request` and handle errors**

Replace the contents of `lib/controllers/manifest_controller.ts`:

```typescript
import { ErrorCode } from "../errors";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import { parseManifest } from "../dash/dash_parser";
import type { Player } from "../player";
import { Request } from "../utils/request";

export class ManifestController {
  private request_: Request<"text"> | null = null;

  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    this.request_?.cancel();
    this.request_ = null;
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const { url } = event;

    this.request_ = new Request(url, "text");

    try {
      const text = await this.request_.response;
      this.request_ = null;

      const manifest = await parseManifest(text, url);
      this.player_.emit(Events.MANIFEST_PARSED, { manifest });
    } catch (error) {
      this.request_ = null;

      if (error instanceof DOMException && error.name === "AbortError") {
        this.player_.emit(Events.ERROR, {
          error: {
            code: ErrorCode.MANIFEST_CANCELLED,
            fatal: false,
            data: { url },
          },
        });
        return;
      }

      this.player_.emit(Events.ERROR, {
        error: {
          code: ErrorCode.MANIFEST_LOAD_FAILED,
          fatal: true,
          data: {
            url,
            status: null,
          },
        },
      });
    }
  };
}
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 4: Verify dev server loads and plays**

Run: `pnpm dev`
Manual check: open the example app, confirm manifest loads and playback starts.

- [ ] **Step 5: Commit**

```
feat: wire Request into ManifestController with error handling
```

---

### Task 4: Wire `Request` into StreamController

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

This is the core change. Replace bare `fetch` with `Request`, store on `MediaState`, remove `State.LOADING`, and add seek abort handling.

- [ ] **Step 1: Update `State` enum and `MediaState` type**

In `lib/controllers/stream_controller.ts`, remove `LOADING` from the `State` enum:

```typescript
enum State {
  STOPPED,
  IDLE,
  ENDED,
}
```

Add `request` field to `MediaState`:

```typescript
type MediaState = {
  state: State;
  request: Request<"arraybuffer"> | null;
  presentation: Presentation;
  selectionSet: SelectionSet;
  switchingSet: SwitchingSet;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  timer: Timer;
};
```

Add imports at the top:

```typescript
import { ErrorCode } from "../errors";
import { Request } from "../utils/request";
```

- [ ] **Step 2: Update `tryStart_` to initialize `request` field**

In the `mediaState` object literal inside `tryStart_`, add `request: null`:

```typescript
const mediaState: MediaState = {
  state: State.IDLE,
  request: null,
  presentation,
  selectionSet,
  switchingSet,
  track,
  lastSegment: null,
  lastInitSegment: null,
  timer: new Timer(() => this.onUpdate_(mediaState)),
};
```

- [ ] **Step 3: Update `update_` to use `request` instead of state check**

Change the idle check in `update_` from:

```typescript
if (mediaState.state !== State.IDLE) {
  return;
}
```

to:

```typescript
if (mediaState.state !== State.IDLE || mediaState.request) {
  return;
}
```

- [ ] **Step 4: Update `onBufferAppended_` to clear `request`**

Replace the `onBufferAppended_` handler:

```typescript
private onBufferAppended_ = (event: BufferAppendedEvent) => {
  const mediaState = this.mediaStates_.get(event.type);
  if (mediaState) {
    mediaState.request = null;
  }
};
```

- [ ] **Step 5: Rewrite `loadInitSegment_` to use `Request`**

```typescript
private async loadInitSegment_(mediaState: MediaState) {
  const { initSegment } = mediaState.track;

  if (mediaState.lastInitSegment === initSegment) {
    return;
  }

  const type = mediaState.selectionSet.type;
  const request = new Request(initSegment.url, "arraybuffer");
  mediaState.request = request;

  try {
    const data = await request.response;

    if (mediaState.request !== request) {
      return;
    }

    mediaState.lastInitSegment = initSegment;

    this.player_.emit(Events.BUFFER_APPENDING, {
      type,
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
          data: { url: initSegment.url, mediaType: type },
        },
      });
      return;
    }

    this.player_.emit(Events.ERROR, {
      error: {
        code: ErrorCode.SEGMENT_LOAD_FAILED,
        fatal: true,
        data: { url: initSegment.url, mediaType: type, status: null },
      },
    });
  }
}
```

- [ ] **Step 6: Rewrite `loadSegment_` to use `Request`**

```typescript
private async loadSegment_(mediaState: MediaState, segment: Segment) {
  const type = mediaState.selectionSet.type;
  const request = new Request(segment.url, "arraybuffer");
  mediaState.request = request;
  mediaState.lastSegment = segment;

  try {
    const data = await request.response;

    if (mediaState.request !== request) {
      return;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type,
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
          data: { url: segment.url, mediaType: type },
        },
      });
      return;
    }

    this.player_.emit(Events.ERROR, {
      error: {
        code: ErrorCode.SEGMENT_LOAD_FAILED,
        fatal: true,
        data: { url: segment.url, mediaType: type, status: null },
      },
    });
  }
}
```

- [ ] **Step 7: Add seek handling — listen for `seeking` on media element**

Add a `onSeeking_` handler and bind/unbind it on attach/detach.

In `onMediaAttached_`, after `this.media_ = event.media`, add:

```typescript
this.media_.addEventListener("seeking", this.onSeeking_);
```

In `onMediaDetached_`, before `this.media_ = null`, add:

```typescript
this.media_?.removeEventListener("seeking", this.onSeeking_);
```

Add the handler:

```typescript
private onSeeking_ = () => {
  for (const mediaState of this.mediaStates_.values()) {
    if (mediaState.state === State.STOPPED || mediaState.state === State.ENDED) {
      continue;
    }
    mediaState.request?.cancel();
    mediaState.request = null;
    mediaState.lastSegment = null;
    mediaState.state = State.IDLE;
  }
};
```

- [ ] **Step 8: Update `destroy` to cancel all in-flight requests**

In `destroy()`, inside the `for` loop over `mediaStates_.values()`, add:

```typescript
mediaState.request?.cancel();
```

- [ ] **Step 9: Run type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 10: Run format check**

Run: `pnpm format`
Expected: PASS — or fix any formatting issues

- [ ] **Step 11: Verify dev server — playback and seek**

Run: `pnpm dev`
Manual check:
1. Playback starts normally
2. Seek during playback — should jump cleanly to new position
3. No stale segment loads after seek

- [ ] **Step 12: Commit**

```
feat: wire Request into StreamController with seek abort handling
```

---

### Task 5: Clean up TODO

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Remove the AbortController TODO item**

Remove line 11 from `TODO.md`:

```
AbortController for in-flight segment fetches — replace State.LOADING with AbortController on MediaState. On seek: abort fetch, null lastSegment, start fresh from new position. Listen for `seeking` event to trigger abort + state reset. Without this, seeking during a load leaves lastSegment stale. Both shaka v2 (operation.abort()) and hls.js (fragPrevious + sequence tracking) handle this.
```

- [ ] **Step 2: Commit**

```
chore: remove completed AbortController TODO
```
