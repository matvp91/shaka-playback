# Network Layer Simplification

## Problem

The current network layer uses classes (`Request`, `Response`) with
a symbol-based mechanism (`resolversSymbol`) for NetworkService to
resolve promises externally. This creates coupling between Request
and NetworkService through shared symbols, and forces callers to
juggle `request: Request | null` — setting it to null after every
await and on every cancel path.

## Goals

- Replace `Request` and `Response` classes with plain types
- NetworkService owns the full request lifecycle: construction,
  fetch, state tracking, cancellation, and future retry logic
- Callers store `lastRequest: Request | null` (null only at init,
  never set back to null)
- Generic `ResponseType` on Request infers the response data type
  (`ArrayBuffer` or `string`)
- Remove all symbol-based internal access patterns

## Non-Goals

- Retry logic implementation (future — but the design must support
  it without structural changes)
- Error system changes
- Caching or progress events

## Design

### Types — `lib/net/types.ts`

All network types live in a single file. Request and Response are
plain mutable objects, not classes.

```typescript
type HttpMethod = "GET" | "POST";
type ResponseType = "arrayBuffer" | "text";

const ABORTED: unique symbol = Symbol("ABORTED");

type ResponseData = {
  arrayBuffer: ArrayBuffer;
  text: string;
};

type Request<T extends ResponseType> = {
  url: string;
  method: HttpMethod;
  headers: Headers;
  responseType: T;
  inFlight: boolean;
  cancelled: boolean;
  promise: Promise<Response<T> | typeof ABORTED>;
};

type Response<T extends ResponseType> = {
  request: Request<T>;
  status: number;
  headers: Headers;
  data: ResponseData[T];
  timeElapsed: number;
};
```

- No default on the `ResponseType` generic — every call site must
  be explicit about what data type it expects
- `inFlight`, `cancelled`, and `promise` are managed exclusively
  by NetworkService — callers read but never write these
- `Request` is mutable so event listeners can modify properties
  (url, headers, method) before the fetch fires
- `promise` resolves with the eventual `Response` or `ABORTED`
  symbol on cancel — managed via `Promise.withResolvers()`

### NetworkService — `lib/net/network_service.ts`

Single authority for all network activity. Owns request
construction, fetch execution, state mutation, cancellation,
and event emission.

```typescript
enum RequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

type RequestEntry = {
  controller: AbortController;
  resolve: (value: Response | typeof ABORTED) => void;
};

class NetworkService {
  private entries_ = new Map<Request, RequestEntry>();

  constructor(private player_: Player) {}

  request<T extends ResponseType>(
    type: RequestType,
    url: string,
    responseType: T,
  ): Request<T>;

  cancel(request: Request): void;
}
```

#### `request()` flow

1. Create the `Request<T>` object with defaults
   (method: `"GET"`, headers: `new Headers()`,
   `inFlight: true`, `cancelled: false`)
2. Create `Promise.withResolvers<Response<T> | null>()` —
   assign `promise` to the request, keep `resolve` internally
3. Create `AbortController`, store both controller and resolve
   in `entries_` map keyed by request
4. Emit `NETWORK_REQUEST` synchronously (listeners can mutate
   url, headers, method)
5. Kick off async fetch (not awaited):
   a. Execute fetch with request properties and abort signal
   b. Read response body as `arrayBuffer` or `text` based on
      `request.responseType`
   c. Build `Response<T>` with the correctly typed `data`
   d. Emit `NETWORK_RESPONSE`
   e. Set `request.inFlight = false`
   f. Delete entry from `entries_` map
   g. Call `resolve(response)`
6. Return the `Request<T>` object

On abort: set `inFlight = false`, delete entry, resolve `ABORTED`.
On error: set `inFlight = false`, delete entry, reject.

#### `cancel()` flow

1. Look up entry in `entries_` map
2. Set `request.cancelled = true`, `request.inFlight = false`
3. Abort the controller, call `resolve(ABORTED)`
4. Delete from `entries_` map

#### Retry support (future)

When retry logic is added, NetworkService replaces the
`AbortController` in the map for each attempt. `request.inFlight`
stays `true` across retries — callers don't know about retries.
Before each retry, NetworkService checks `request.cancelled` to
decide whether to continue. `cancel()` sets `cancelled = true` and
aborts the current attempt, which prevents further retries.

### Caller Impact

#### MediaState (StreamController)

```typescript
type MediaState = {
  type: MediaType;
  ended: boolean;
  presentation: Presentation;
  track: Track;
  lastSegment: Segment | null;
  lastInitSegment: InitSegment | null;
  lastRequest: Request<"arrayBuffer"> | null;
  timer: Timer;
};
```

- Initialized with `lastRequest: null` (never requested yet)
- Never set back to null after a request completes
- Tick guard: `mediaState.lastRequest?.inFlight`
- Cancel: `this.networkService_.cancel(mediaState.lastRequest)`

#### ManifestController

```typescript
private lastRequest_: Request<"text"> | null = null;
```

- Same pattern: null at init, never nulled after first request
- Cancel: `this.networkService_.cancel(this.lastRequest_)`

#### Load segment example

```typescript
private async loadSegment_(mediaState: MediaState, segment: Segment) {
  mediaState.lastRequest = this.networkService_.request(
    RequestType.SEGMENT, segment.url, "arrayBuffer",
  );

  const response = await mediaState.lastRequest.promise;
  if (response === ABORTED) return;

  this.player_.emit(Events.BUFFER_APPENDING, {
    type: mediaState.type,
    initSegment: mediaState.track.initSegment,
    segment,
    data: response.data,  // typed as ArrayBuffer
  });
}
```

#### Load manifest example

```typescript
private onManifestLoading_ = async (event: ManifestLoadingEvent) => {
  this.lastRequest_ = this.networkService_.request(
    RequestType.MANIFEST, event.url, "text",
  );

  const response = await this.lastRequest_.promise;
  if (response === ABORTED) return;

  const manifest = await parseManifest(response.data, event.url);
  this.player_.emit(Events.MANIFEST_PARSED, { manifest });
};
```

Note: `response.data` is typed as `string` here — no `.text()`
method needed.

### Events

No changes to event structure, only the payload types update
to use the new `Request` and `Response` types:

```typescript
NETWORK_REQUEST: {
  type: RequestType;
  request: Request<ResponseType>;
}

NETWORK_RESPONSE: {
  type: RequestType;
  request: Request<ResponseType>;
  response: Response<ResponseType>;
}
```

## Data Flow

### Successful segment load
```
networkService.request(SEGMENT, url, "arrayBuffer")
  → creates Request, inFlight = true, controller stored
  → NETWORK_REQUEST emitted (mutation window)
  → fetch executes, reads arrayBuffer
  → NETWORK_RESPONSE emitted
  → inFlight = false, controller deleted
  → promise resolves with Response<"arrayBuffer">
```

### Cancelled during fetch
```
caller calls networkService.cancel(request)
  → cancelled = true, inFlight = false
  → controller aborted, deleted from map
  → promise resolves with ABORTED
```

### Cancelled during retry (future)
```
attempt 1 fails → check cancelled? no → retry
attempt 2 in progress → caller calls cancel()
  → cancelled = true, abort current fetch
  → check cancelled? yes → stop, resolve ABORTED
```

## File Changes

### Modified
- `lib/net/types.ts` — Request type, Response type,
  ResponseType, ResponseData, ABORTED symbol
  (replaces resolversSymbol)
- `lib/net/network_service.ts` — owns full lifecycle,
  request construction, cancel() method, AbortController map
- `lib/controllers/stream_controller.ts` — lastRequest
  pattern, no null juggling
- `lib/controllers/manifest_controller.ts` — lastRequest
  pattern, no null juggling
- `lib/events.ts` — update event payload types

### Deleted
- `lib/net/request.ts` — Request class replaced by type
- `lib/net/response.ts` — Response class replaced by type
