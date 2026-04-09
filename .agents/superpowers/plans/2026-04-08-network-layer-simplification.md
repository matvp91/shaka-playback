# Network Layer Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Request/Response classes and symbol-based coupling with plain types, NetworkService-owned lifecycle, and `ABORTED` symbol for cancellation.

**Architecture:** All network types move to `lib/net/types.ts` as plain objects. `NetworkService` becomes the single authority — it constructs requests, manages AbortControllers via an internal map, and resolves promises via `Promise.withResolvers()`. Callers store `lastRequest` (never nulled after first use) and check `inFlight` instead of null-checking.

**Tech Stack:** TypeScript, Biome

**Spec:** `docs/superpowers/specs/2026-04-08-network-layer-simplification-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/net/types.ts` | Rewrite | All network types: `Request<T>`, `Response<T>`, `ResponseType`, `ResponseData`, `HttpMethod`, `ABORTED` |
| `lib/net/network_service.ts` | Rewrite | Request construction, fetch execution, state management, cancellation, events |
| `lib/events.ts` | Modify | Update event payload types to new `Request`/`Response` types |
| `lib/controllers/manifest_controller.ts` | Modify | `lastRequest_` pattern, use new NetworkService API |
| `lib/controllers/stream_controller.ts` | Modify | `lastRequest` pattern in MediaState, use new NetworkService API |
| `lib/net/request.ts` | Delete | Replaced by type in `types.ts` |
| `lib/net/response.ts` | Delete | Replaced by type in `types.ts` |

---

### Task 1: Rewrite `lib/net/types.ts`

**Files:**
- Rewrite: `lib/net/types.ts`

- [ ] **Step 1: Replace contents of `lib/net/types.ts`**

The file currently contains only `export const resolversSymbol = Symbol("promiseResolvers");`. Replace with all network types:

```typescript
export type HttpMethod = "GET" | "POST";

export type ResponseType = "arrayBuffer" | "text";

export const ABORTED: unique symbol = Symbol("ABORTED");

type ResponseData = {
  arrayBuffer: ArrayBuffer;
  text: string;
};

export type Request<T extends ResponseType> = {
  url: string;
  method: HttpMethod;
  headers: Headers;
  responseType: T;
  inFlight: boolean;
  cancelled: boolean;
  promise: Promise<Response<T> | typeof ABORTED>;
};

export type Response<T extends ResponseType> = {
  request: Request<T>;
  status: number;
  headers: Headers;
  data: ResponseData[T];
  timeElapsed: number;
};
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: Errors in files that still import from old `request.ts` and `response.ts` — this is expected and will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/net/types.ts
git commit -m "refactor: replace resolversSymbol with network types in types.ts"
```

---

### Task 2: Rewrite `lib/net/network_service.ts`

**Files:**
- Rewrite: `lib/net/network_service.ts`

- [ ] **Step 1: Replace contents of `lib/net/network_service.ts`**

```typescript
import { Events } from "../events";
import type { Player } from "../player";
import {
  ABORTED,
  type Request,
  type Response,
  type ResponseType,
} from "./types";

export enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

type RequestEntry = {
  controller: AbortController;
  resolve: (value: Response<ResponseType> | typeof ABORTED) => void;
  reject: (reason: unknown) => void;
};

/**
 * Central service for all network requests.
 * Created by Player, passed to controllers.
 * Owns request construction, fetch execution,
 * state management, and cancellation.
 */
export class NetworkService {
  private entries_ = new Map<
    Request<ResponseType>,
    RequestEntry
  >();

  constructor(private player_: Player) {}

  /**
   * Start a network request. Constructs the request
   * object, emits NETWORK_REQUEST synchronously
   * (allowing listeners to mutate url, headers,
   * method), then kicks off the fetch. Returns the
   * request handle for state inspection and
   * cancellation.
   */
  request<T extends ResponseType>(
    type: RequestType,
    url: string,
    responseType: T,
  ): Request<T> {
    const { promise, resolve, reject } =
      Promise.withResolvers<Response<T> | typeof ABORTED>();

    const controller = new AbortController();

    const request: Request<T> = {
      url,
      method: "GET",
      headers: new Headers(),
      responseType,
      inFlight: true,
      cancelled: false,
      promise,
    };

    this.entries_.set(
      request,
      { controller, resolve, reject } as RequestEntry,
    );

    this.player_.emit(Events.NETWORK_REQUEST, {
      type,
      request,
    });

    this.fetch_(type, request, controller.signal)
      .then((response) => {
        request.inFlight = false;
        this.entries_.delete(request);

        this.player_.emit(Events.NETWORK_RESPONSE, {
          type,
          request,
          response,
        });

        resolve(response);
      })
      .catch((error) => {
        request.inFlight = false;
        this.entries_.delete(request);

        if (isAbortError(error)) {
          resolve(ABORTED);
        } else {
          reject(error);
        }
      });

    return request;
  }

  /** Cancel an in-flight request. */
  cancel(request: Request<ResponseType>) {
    const entry = this.entries_.get(request);
    if (!entry) {
      return;
    }

    request.cancelled = true;
    request.inFlight = false;
    entry.controller.abort();
    entry.resolve(ABORTED);
    this.entries_.delete(request);
  }

  private async fetch_<T extends ResponseType>(
    type: RequestType,
    request: Request<T>,
    signal: AbortSignal,
  ): Promise<Response<T>> {
    const start = performance.now();

    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal,
    });

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${res.statusText}`,
      );
    }

    const data = request.responseType === "text"
      ? await res.text()
      : await res.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return {
      request,
      status: res.status,
      headers: res.headers,
      data: data as Response<T>["data"],
      timeElapsed,
    };
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: Errors in `events.ts`, `manifest_controller.ts`, `stream_controller.ts` — they still import old types. Fixed in next tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/net/network_service.ts
git commit -m "refactor: rewrite NetworkService to own full request lifecycle"
```

---

### Task 3: Update `lib/events.ts`

**Files:**
- Modify: `lib/events.ts`

- [ ] **Step 1: Update imports and event types**

Replace the imports and event types for network events:

Old imports (lines 1-3):
```typescript
import type { RequestType } from "./net/network_service";
import type { Request } from "./net/request";
import type { Response } from "./net/response";
```

New imports:
```typescript
import type { RequestType } from "./net/network_service";
import type {
  Request,
  Response,
  type ResponseType,
} from "./net/types";
```

Replace `NetworkRequestEvent` (lines 67-70):
```typescript
export type NetworkRequestEvent = {
  type: RequestType;
  request: Request<ResponseType>;
};
```

Replace `NetworkResponseEvent` (lines 72-76):
```typescript
export type NetworkResponseEvent = {
  type: RequestType;
  request: Request<ResponseType>;
  response: Response<ResponseType>;
};
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: Errors only in `manifest_controller.ts` and `stream_controller.ts` now.

- [ ] **Step 3: Commit**

```bash
git add lib/events.ts
git commit -m "refactor: update event types for new Request/Response"
```

---

### Task 4: Update `lib/controllers/manifest_controller.ts`

**Files:**
- Modify: `lib/controllers/manifest_controller.ts`

- [ ] **Step 1: Rewrite ManifestController**

```typescript
import { parseManifest } from "../dash/dash_parser";
import type { ManifestLoadingEvent } from "../events";
import { Events } from "../events";
import type { NetworkService } from "../net/network_service";
import { RequestType } from "../net/network_service";
import { ABORTED, type Request } from "../net/types";
import type { Player } from "../player";

export class ManifestController {
  private lastRequest_: Request<"text"> | null = null;

  constructor(
    private player_: Player,
    private networkService_: NetworkService,
  ) {
    this.player_.on(
      Events.MANIFEST_LOADING,
      this.onManifestLoading_,
    );
  }

  destroy() {
    if (this.lastRequest_) {
      this.networkService_.cancel(this.lastRequest_);
    }
    this.player_.off(
      Events.MANIFEST_LOADING,
      this.onManifestLoading_,
    );
  }

  private onManifestLoading_ = async (
    event: ManifestLoadingEvent,
  ) => {
    this.lastRequest_ = this.networkService_.request(
      RequestType.MANIFEST,
      event.url,
      "text",
    );

    const response = await this.lastRequest_.promise;
    if (response === ABORTED) {
      return;
    }

    const manifest = await parseManifest(
      response.data,
      event.url,
    );
    this.player_.emit(Events.MANIFEST_PARSED, { manifest });
  };
}
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: Errors only in `stream_controller.ts` now.

- [ ] **Step 3: Commit**

```bash
git add lib/controllers/manifest_controller.ts
git commit -m "refactor: ManifestController uses lastRequest pattern"
```

---

### Task 5: Update `lib/controllers/stream_controller.ts`

**Files:**
- Modify: `lib/controllers/stream_controller.ts`

- [ ] **Step 1: Update imports**

Remove:
```typescript
import { Request } from "../net/request";
```

Add:
```typescript
import { ABORTED, type Request } from "../net/types";
```

- [ ] **Step 2: Update MediaState type**

Replace the `request` field (line 35):
```typescript
  request: Request | null;
```

With:
```typescript
  lastRequest: Request<"arrayBuffer"> | null;
```

- [ ] **Step 3: Update `tryStart_()` — initial value**

In the MediaState initialization (line 120), replace:
```typescript
        request: null,
```

With:
```typescript
        lastRequest: null,
```

- [ ] **Step 4: Update `update_()` — tick guard**

Replace the guard (line 147):
```typescript
    if (mediaState.ended || mediaState.request !== null) {
```

With:
```typescript
    if (mediaState.ended || mediaState.lastRequest?.inFlight) {
```

- [ ] **Step 5: Update `loadInitSegment_()`**

Replace lines 225-231:
```typescript
    mediaState.request = this.networkService_.request(
      RequestType.SEGMENT,
      new Request(initSegment.url),
    );

    const response = await mediaState.request.promise;
    mediaState.request = null;
```

With:
```typescript
    mediaState.lastRequest = this.networkService_.request(
      RequestType.SEGMENT,
      initSegment.url,
      "arrayBuffer",
    );

    const response = await mediaState.lastRequest.promise;
```

Replace the null check (line 233):
```typescript
    if (!response) {
```

With:
```typescript
    if (response === ABORTED) {
```

- [ ] **Step 6: Update `loadSegment_()`**

Replace lines 250-256:
```typescript
    mediaState.request = this.networkService_.request(
      RequestType.SEGMENT,
      new Request(segment.url),
    );

    const response = await mediaState.request.promise;
    mediaState.request = null;
```

With:
```typescript
    mediaState.lastRequest = this.networkService_.request(
      RequestType.SEGMENT,
      segment.url,
      "arrayBuffer",
    );

    const response = await mediaState.lastRequest.promise;
```

Replace the null check (line 258):
```typescript
    if (!response) {
```

With:
```typescript
    if (response === ABORTED) {
```

- [ ] **Step 7: Update `destroy()`**

Replace line 57:
```typescript
      mediaState.request?.cancel();
```

With:
```typescript
      if (mediaState.lastRequest) {
        this.networkService_.cancel(mediaState.lastRequest);
      }
```

- [ ] **Step 8: Update `onMediaDetached_()`**

Replace lines 85-87:
```typescript
      mediaState.request?.cancel();
      mediaState.request = null;
```

With:
```typescript
      if (mediaState.lastRequest) {
        this.networkService_.cancel(mediaState.lastRequest);
      }
```

- [ ] **Step 9: Update `onSeeking_()`**

Replace lines 373-374:
```typescript
      mediaState.request?.cancel();
      mediaState.request = null;
```

With:
```typescript
      if (mediaState.lastRequest) {
        this.networkService_.cancel(mediaState.lastRequest);
      }
```

- [ ] **Step 10: Run type check**

Run: `pnpm tsc`
Expected: PASS — all references to old types resolved.

- [ ] **Step 11: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: StreamController uses lastRequest pattern"
```

---

### Task 6: Delete old files

**Files:**
- Delete: `lib/net/request.ts`
- Delete: `lib/net/response.ts`

- [ ] **Step 1: Delete `lib/net/request.ts` and `lib/net/response.ts`**

```bash
rm lib/net/request.ts lib/net/response.ts
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: PASS — no remaining imports from deleted files.

- [ ] **Step 3: Run format check**

Run: `pnpm format`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/net/request.ts lib/net/response.ts
git commit -m "refactor: remove Request/Response classes"
```
