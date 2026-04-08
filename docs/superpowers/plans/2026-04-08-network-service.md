# Network Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated fetch logic (`Request<T>` and `SegmentFetch`) with a centralized `NetworkService` that provides structured requests, responses, and network observability via events.

**Architecture:** A `NetworkService` class created by Player and passed to controllers. Controllers call `networkService.request()` which returns a `PendingRequest` handle with `.promise` and `.cancel()`. All network activity emits `NETWORK_REQUEST`/`NETWORK_RESPONSE` events for observability and request mutation.

**Tech Stack:** TypeScript, native Fetch API, AbortController

---

## File Structure

```
lib/net/
  request.ts           — Request type, HttpMethod type, makeRequest()
  pending_request.ts   — PendingRequest class, REQUEST_CANCELLED symbol
  response.ts          — Response class with ArrayBuffer data + text()
  network_service.ts   — NetworkService class, RequestType enum

Modified:
  lib/events.ts        — Add NETWORK_REQUEST, NETWORK_RESPONSE events; remove ERROR event
  lib/player.ts        — Create NetworkService, pass to controllers
  lib/controllers/manifest_controller.ts — Use NetworkService
  lib/controllers/stream_controller.ts   — Use NetworkService

Removed:
  lib/utils/request.ts
  lib/controllers/segment_fetch.ts
  lib/errors.ts
```

---

### Task 1: Create Request type and makeRequest factory

**Files:**
- Create: `lib/net/request.ts`

- [ ] **Step 1: Create `lib/net/request.ts`**

```typescript
export type HttpMethod = "GET" | "POST";

/**
 * Mutable request descriptor. Event listeners
 * can modify properties before the fetch fires.
 */
export type Request = {
  url: string;
  method: HttpMethod;
  headers: Headers;
};

/**
 * Create a request with sensible defaults.
 * Method defaults to GET, headers to empty.
 */
export function makeRequest(url: string): Request {
  return {
    url,
    method: "GET",
    headers: new Headers(),
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors related to `lib/net/request.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/net/request.ts
git commit -m "feat(net): add Request type and makeRequest factory"
```

---

### Task 2: Create Response class

**Files:**
- Create: `lib/net/response.ts`

- [ ] **Step 1: Create `lib/net/response.ts`**

```typescript
const decoder = new TextDecoder();

/**
 * Immutable network response. Data is always
 * fetched as ArrayBuffer — use text() to decode.
 */
export class Response {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly data: ArrayBuffer;
  readonly timeElapsed: number;

  constructor(
    url: string,
    status: number,
    headers: Headers,
    data: ArrayBuffer,
    timeElapsed: number,
  ) {
    this.url = url;
    this.status = status;
    this.headers = headers;
    this.data = data;
    this.timeElapsed = timeElapsed;
  }

  /** Decode the ArrayBuffer as UTF-8 text. */
  text(): string {
    return decoder.decode(this.data);
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors related to `lib/net/response.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/net/response.ts
git commit -m "feat(net): add Response class"
```

---

### Task 3: Create PendingRequest class

**Files:**
- Create: `lib/net/pending_request.ts`

- [ ] **Step 1: Create `lib/net/pending_request.ts`**

```typescript
import type { Request } from "./request";
import type { Response } from "./response";

export const REQUEST_CANCELLED = Symbol.for("REQUEST_CANCELLED");

/**
 * In-flight network operation handle. Created
 * only by NetworkService.request(). Wraps the
 * fetch promise and manages cancellation.
 */
export class PendingRequest {
  readonly request: Request;
  readonly promise: Promise<Response | typeof REQUEST_CANCELLED>;

  private controller_: AbortController;

  constructor(
    request: Request,
    promise: Promise<Response | typeof REQUEST_CANCELLED>,
    controller: AbortController,
  ) {
    this.request = request;
    this.promise = promise;
    this.controller_ = controller;
  }

  /** Abort the in-flight request. */
  cancel() {
    this.controller_.abort();
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors related to `lib/net/pending_request.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/net/pending_request.ts
git commit -m "feat(net): add PendingRequest class"
```

---

### Task 4: Add network events to events.ts

**Files:**
- Modify: `lib/events.ts`

- [ ] **Step 1: Add imports and event types**

Add `Request` and `Response` imports at the top of `lib/events.ts`:

```typescript
import type { Request } from "./net/request";
import type { RequestType } from "./net/network_service";
import type { Response } from "./net/response";
```

Note: `RequestType` doesn't exist yet — we'll create it in Task 5. This will cause a temporary type error that resolves after Task 5.

Add the event types after the existing `BufferAppendedEvent`:

```typescript
export type NetworkRequestEvent = {
  type: RequestType;
  request: Request;
};

export type NetworkResponseEvent = {
  type: RequestType;
  request: Request;
  response: Response;
};
```

- [ ] **Step 2: Add events to the Events object and EventMap**

Add to the `Events` object, before `ERROR`:

```typescript
  NETWORK_REQUEST: "networkRequest",
  NETWORK_RESPONSE: "networkResponse",
```

Add to the `EventMap` interface:

```typescript
  [Events.NETWORK_REQUEST]: (event: NetworkRequestEvent) => void;
  [Events.NETWORK_RESPONSE]: (event: NetworkResponseEvent) => void;
```

- [ ] **Step 3: Commit**

```bash
git add lib/events.ts
git commit -m "feat(events): add NETWORK_REQUEST and NETWORK_RESPONSE events"
```

---

### Task 5: Create NetworkService

**Files:**
- Create: `lib/net/network_service.ts`

- [ ] **Step 1: Create `lib/net/network_service.ts`**

```typescript
import { Events } from "../events";
import type { Player } from "../player";
import type { Request } from "./request";
import { PendingRequest, REQUEST_CANCELLED } from "./pending_request";
import { Response } from "./response";

export enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

/**
 * Central service for all network requests.
 * Created by Player, passed to controllers.
 * Owns fetch execution and event emission.
 */
export class NetworkService {
  private player_: Player;

  constructor(player: Player) {
    this.player_ = player;
  }

  /**
   * Start a network request. Emits NETWORK_REQUEST
   * synchronously before the fetch fires, allowing
   * listeners to mutate the request. Returns a
   * PendingRequest handle for cancellation.
   */
  request(type: RequestType, request: Request): PendingRequest {
    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    const controller = new AbortController();

    const promise = this.fetch_(request, controller).then(
      (response) => {
        this.player_.emit(Events.NETWORK_RESPONSE, {
          type,
          request,
          response,
        });
        return response;
      },
      (error) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return REQUEST_CANCELLED;
        }
        throw error;
      },
    );

    return new PendingRequest(request, promise, controller);
  }

  private async fetch_(
    request: Request,
    controller: AbortController,
  ): Promise<Response> {
    const start = performance.now();

    const fetchResponse = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
    });

    const data = await fetchResponse.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return new Response(
      fetchResponse.url,
      fetchResponse.status,
      fetchResponse.headers,
      data,
      timeElapsed,
    );
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors related to `lib/net/` files. The import of `RequestType` in `events.ts` from Task 4 should now resolve.

- [ ] **Step 3: Commit**

```bash
git add lib/net/network_service.ts
git commit -m "feat(net): add NetworkService"
```

---

### Task 6: Wire NetworkService into Player

**Files:**
- Modify: `lib/player.ts`

- [ ] **Step 1: Add NetworkService to Player**

Add the import at the top of `lib/player.ts`:

```typescript
import { NetworkService } from "./net/network_service";
```

Add a private field after `private media_`:

```typescript
  private networkService_: NetworkService;
```

Initialize it in the constructor, before creating controllers:

```typescript
    this.networkService_ = new NetworkService(this);
```

- [ ] **Step 2: Pass NetworkService to ManifestController**

Change the ManifestController construction from:

```typescript
    this.manifestController_ = new ManifestController(this);
```

to:

```typescript
    this.manifestController_ = new ManifestController(this, this.networkService_);
```

- [ ] **Step 3: Pass NetworkService to StreamController**

Change the StreamController construction from:

```typescript
    this.streamController_ = new StreamController(this);
```

to:

```typescript
    this.streamController_ = new StreamController(this, this.networkService_);
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm tsc`
Expected: Errors in ManifestController and StreamController constructors (they don't accept the second parameter yet). This is expected — we fix it in Tasks 7 and 8.

- [ ] **Step 5: Commit**

```bash
git add lib/player.ts
git commit -m "feat(player): create NetworkService and pass to controllers"
```

---

### Task 7: Migrate ManifestController to NetworkService

**Files:**
- Modify: `lib/controllers/manifest_controller.ts`

- [ ] **Step 1: Rewrite ManifestController**

Replace the entire contents of `lib/controllers/manifest_controller.ts`:

```typescript
import { parseManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import { RequestType } from "../net/network_service";
import type { NetworkService } from "../net/network_service";
import type { PendingRequest } from "../net/pending_request";
import { REQUEST_CANCELLED } from "../net/pending_request";
import { makeRequest } from "../net/request";
import type { Player } from "../player";

export class ManifestController {
  private pending_: PendingRequest | null = null;

  constructor(
    private player_: Player,
    private networkService_: NetworkService,
  ) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  destroy() {
    this.pending_?.cancel();
    this.pending_ = null;
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }

  private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
    const { url } = event;

    this.pending_ = this.networkService_.request(
      RequestType.MANIFEST,
      makeRequest(url),
    );

    const result = await this.pending_.promise;
    this.pending_ = null;

    if (result === REQUEST_CANCELLED) {
      return;
    }

    const manifest = await parseManifest(result.text(), url);
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: No errors in `manifest_controller.ts`. StreamController may still have errors (fixed in Task 8).

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/manifest_controller.ts
git commit -m "refactor(manifest): migrate to NetworkService"
```

---

### Task 8: Migrate StreamController to NetworkService

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Update imports**

Replace the SegmentFetch import in `lib/controllers/stream_controller.ts`:

```typescript
import { SegmentFetch } from "./segment_fetch";
```

with:

```typescript
import { RequestType } from "../net/network_service";
import type { NetworkService } from "../net/network_service";
import type { PendingRequest } from "../net/pending_request";
import { REQUEST_CANCELLED } from "../net/pending_request";
import { makeRequest } from "../net/request";
```

- [ ] **Step 2: Update MediaState type**

Change the `fetch` field in the `MediaState` type from:

```typescript
  fetch: SegmentFetch;
```

to:

```typescript
  pending: PendingRequest | null;
```

- [ ] **Step 3: Update constructor to accept NetworkService**

Change the constructor from:

```typescript
  constructor(private player_: Player) {
```

to:

```typescript
  constructor(
    private player_: Player,
    private networkService_: NetworkService,
  ) {
```

- [ ] **Step 4: Update tryStart_ — replace SegmentFetch with null pending**

In `tryStart_()`, change the MediaState creation from:

```typescript
      const mediaState: MediaState = {
        type,
        ended: false,
        presentation,
        track,
        lastSegment: null,
        lastInitSegment: null,
        fetch: new SegmentFetch(),
        timer: new Timer(() => this.update_(mediaState)),
      };
```

to:

```typescript
      const mediaState: MediaState = {
        type,
        ended: false,
        presentation,
        track,
        lastSegment: null,
        lastInitSegment: null,
        pending: null,
        timer: new Timer(() => this.update_(mediaState)),
      };
```

- [ ] **Step 5: Update update_ — replace fetch.isLoading() check**

Change the guard in `update_()` from:

```typescript
    if (mediaState.ended || mediaState.fetch.isLoading()) {
```

to:

```typescript
    if (mediaState.ended || mediaState.pending !== null) {
```

- [ ] **Step 6: Rewrite loadInitSegment_**

Replace the `loadInitSegment_` method:

```typescript
  private async loadInitSegment_(mediaState: MediaState) {
    const { initSegment } = mediaState.track;

    mediaState.pending = this.networkService_.request(
      RequestType.SEGMENT,
      makeRequest(initSegment.url),
    );

    const result = await mediaState.pending.promise;
    mediaState.pending = null;

    if (result === REQUEST_CANCELLED) {
      return;
    }

    mediaState.lastInitSegment = initSegment;
    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment,
      data: result.data,
      segment: null,
    });
  }
```

- [ ] **Step 7: Rewrite loadSegment_**

Replace the `loadSegment_` method:

```typescript
  private async loadSegment_(mediaState: MediaState, segment: Segment) {
    mediaState.pending = this.networkService_.request(
      RequestType.SEGMENT,
      makeRequest(segment.url),
    );

    const result = await mediaState.pending.promise;
    mediaState.pending = null;

    if (result === REQUEST_CANCELLED) {
      return;
    }

    this.player_.emit(Events.BUFFER_APPENDING, {
      type: mediaState.type,
      initSegment: mediaState.track.initSegment,
      segment,
      data: result.data,
    });
  }
```

- [ ] **Step 8: Update destroy_ and cancel references**

In `destroy()`, change:

```typescript
      mediaState.fetch.cancel();
```

to:

```typescript
      mediaState.pending?.cancel();
```

In `onMediaDetached_()`, change:

```typescript
      mediaState.fetch.cancel();
```

to:

```typescript
      mediaState.pending?.cancel();
```

In `onSeeking_()`, change:

```typescript
      mediaState.fetch.cancel();
```

to:

```typescript
      mediaState.pending?.cancel();
      mediaState.pending = null;
```

- [ ] **Step 9: Verify types compile**

Run: `pnpm tsc`
Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor(stream): migrate to NetworkService"
```

---

### Task 9: Remove old code and error system

**Files:**
- Remove: `lib/utils/request.ts`
- Remove: `lib/controllers/segment_fetch.ts`
- Remove: `lib/errors.ts`
- Modify: `lib/events.ts`

- [ ] **Step 1: Delete old files**

```bash
rm lib/utils/request.ts lib/controllers/segment_fetch.ts lib/errors.ts
```

- [ ] **Step 2: Remove ERROR event from events.ts**

In `lib/events.ts`, remove the import:

```typescript
import type { PlayerError } from "./errors";
```

Remove the `ErrorEvent` type:

```typescript
export type ErrorEvent = {
  error: PlayerError;
};
```

Remove from the `Events` object:

```typescript
  ERROR: "error",
```

Remove from the `EventMap` interface:

```typescript
  [Events.ERROR]: (event: ErrorEvent) => void;
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: No type errors. If any files still import from deleted modules, fix those imports.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove old Request, SegmentFetch, and error system"
```

---

### Task 10: Format, verify, and test manually

- [ ] **Step 1: Run formatter**

Run: `pnpm format`
Expected: All files formatted without errors

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: No type errors

- [ ] **Step 3: Test with dev server**

Run: `pnpm dev`

Open the example app in a browser. Verify:
- Manifest loads (check console for `NETWORK_REQUEST` / `NETWORK_RESPONSE` events if you add a listener)
- Video plays with segments loading
- Seek works (cancels in-flight requests, resumes from new position)

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: format"
```
