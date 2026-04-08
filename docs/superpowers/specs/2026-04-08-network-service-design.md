# Network Service Design

## Problem

Network requests are split across two implementations with
duplicated fetch logic: `Request<T>` in `lib/utils/request.ts`
(used by ManifestController) and `SegmentFetch` in
`lib/controllers/segment_fetch.ts` (used by StreamController).
Neither validates HTTP status codes, and there is no centralized
network observability. Drawing from Shaka v2's NetworkingEngine
pattern, we introduce a `NetworkService` as the single point
for all network activity.

## Goals

- Single `NetworkService` for all network requests
- `PendingRequest` handle with cancel + promise semantics
- Immutable `Response` with `ArrayBuffer` data and `.text()`
  convenience method
- `NETWORK_REQUEST` / `NETWORK_RESPONSE` events for
  observability and request mutation
- Mutable `Request` type so event listeners can modify
  requests before fetch (e.g., add auth headers, change URL)
- Clean separation: `Request` is data, `PendingRequest` is the
  in-flight operation, `Response` is the result

## Non-Goals

- Error system (deferred — `errors.ts` will be removed)
- Retry logic, timeouts, or backoff strategies (future)
- Caching (belongs in a higher-level layer, not networking)
- Progress events or download stats

## Design

### `Request` — `lib/net/request.ts`

A plain type describing what to fetch. All fields required.
Mutable so event listeners can modify properties before the
fetch fires.

```typescript
type HttpMethod = "GET" | "POST";

type Request = {
  url: string;
  method: HttpMethod;
  headers: Headers;
};

function makeRequest(url: string): Request {
  return {
    url,
    method: "GET",
    headers: new Headers(),
  };
}
```

- `makeRequest(url)` is the factory that sets defaults
- Exported from `request.ts` alongside the `Request` type

### `PendingRequest` — `lib/net/pending_request.ts`

An in-flight operation handle. Created only by
`NetworkService.request()`. Wraps the fetch promise and
manages cancellation via an internal `AbortController`.

```typescript
const REQUEST_CANCELLED = Symbol.for("REQUEST_CANCELLED");

class PendingRequest {
  readonly request: Request;
  readonly promise: Promise<Response | typeof REQUEST_CANCELLED>;

  cancel(): void;
}
```

- `promise` resolves with `Response` on success or
  `REQUEST_CANCELLED` on abort
- `cancel()` aborts the underlying fetch — `promise`
  resolves with `REQUEST_CANCELLED`
- Controllers never touch `AbortController` directly

### `Response` — `lib/net/response.ts`

Immutable result of a network request. Always fetches as
`ArrayBuffer` internally — `.text()` decodes on demand using
a module-level `TextDecoder` instance (single allocation).

```typescript
const decoder = new TextDecoder();

class Response {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly data: ArrayBuffer;
  readonly timeElapsed: number;

  text(): string {
    return decoder.decode(this.data);
  }
}
```

The memory overhead of always using `ArrayBuffer` is
negligible — even a large manifest (200-500KB) briefly
doubles to ~600KB during decode, dwarfed by a single video
segment (2-6MB).

### `NetworkService` — `lib/net/network_service.ts`

Central service for all network requests. Created by Player,
passed to controllers that need network access. Owns the
fetch execution and event emission.

```typescript
enum RequestType {
  MANIFEST,
  SEGMENT,
}

class NetworkService {
  constructor(player: Player);

  request(type: RequestType, data: Request): PendingRequest;
}
```

- `request()` creates a `PendingRequest`, emits
  `NETWORK_REQUEST` synchronously (allowing mutation), starts
  the fetch, and emits `NETWORK_RESPONSE` on completion
- Holds the `Player` reference for event emission
- Future home for retry logic and timeout policies

### Events

Two new events for network observability:

```typescript
NETWORK_REQUEST: {
  type: RequestType;
  request: Request;
}
```

Fired synchronously before the fetch starts. Listeners can
mutate the `Request` (change URL, add headers, switch method)
before the fetch fires.

```typescript
NETWORK_RESPONSE: {
  type: RequestType;
  request: Request;
  response: Response;
}
```

Fired when the fetch completes successfully.

## Data Flow

### Successful segment load
```
controller calls networkService.request(SEGMENT, makeRequest(url))
  → NetworkService creates PendingRequest
  → emits NETWORK_REQUEST (listeners can mutate request)
  → starts fetch with (possibly modified) request
  → fetch completes
  → emits NETWORK_RESPONSE
  → PendingRequest.promise resolves with Response
  → controller reads response.data (ArrayBuffer)
```

### Successful manifest load
```
controller calls networkService.request(MANIFEST, makeRequest(url))
  → same flow as above
  → controller reads response.text() (string)
```

### Cancelled request
```
controller calls pendingRequest.cancel()
  → internal AbortController.abort()
  → PendingRequest.promise resolves with REQUEST_CANCELLED
  → no NETWORK_RESPONSE event emitted
```

### Request mutation via events
```
player.on(NETWORK_REQUEST, ({ request }) => {
  request.headers = new Headers({ Authorization: "Bearer ..." });
});
```

## File Structure

```
lib/net/
  request.ts           — Request type, HttpMethod type, makeRequest()
  pending_request.ts   — PendingRequest class, REQUEST_CANCELLED
  response.ts          — Response class
  network_service.ts   — NetworkService class, RequestType enum
```

## Removals

- `lib/utils/request.ts` — replaced by NetworkService + Request
- `lib/controllers/segment_fetch.ts` — replaced by
  NetworkService + PendingRequest
- `lib/errors.ts` — deferred to a future error system design

## Controller Changes

### ManifestController

Replace `new Request(url, "text")` with
`networkService.request(RequestType.MANIFEST, makeRequest(url))`.
Await `pendingRequest.promise`, call `response.text()`.

### StreamController

Replace `SegmentFetch` usage with
`networkService.request(RequestType.SEGMENT, makeRequest(url))`.
Store `PendingRequest` per media type for cancellation.
On seek: call `pendingRequest.cancel()` per media type.

### Player

Create `NetworkService` instance, pass to ManifestController
and StreamController.

## Deferred

1. **Error system** — design how network errors surface to
   consumers (new error types, fatality, error events)
2. **Retry logic** — exponential backoff with jitter, per
   RequestType configuration, managed by NetworkService
3. **Caching** — segment prefetch cache, lives outside
   NetworkService in a higher-level component
