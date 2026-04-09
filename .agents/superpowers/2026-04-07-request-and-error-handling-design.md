# Request & Error Handling Design

## Problem

All network requests use bare `fetch()` with no cancellation
support. During seek, in-flight segment fetches continue
downloading stale data. There is no error handling — network
failures are unhandled. Both shaka v2 (`operation.abort()`) and
hls.js (loader pattern) solve this; we need our own approach.

## Goals

- Cancellable network requests via a `Request` class
- Type-safe error system with discriminated error codes
- Seek triggers abort of in-flight fetches
- All network requests (manifest + segments) flow through
  `Request`
- Fatal/non-fatal error distinction for future retry strategies

## Non-Goals

- Retries, timeouts, or backoff strategies
- Consumer-facing loader API or request interception
- Progress events or download stats
- Request prioritization or queuing

## Design

### `Request<T>` — `lib/utils/request.ts`

A generic wrapper around `fetch` with type-safe responses and
cancellation.

```typescript
type ResponseTypeMap = {
  text: string;
  arraybuffer: ArrayBuffer;
};

class Request<T extends keyof ResponseTypeMap> {
  readonly response: Promise<ResponseTypeMap[T]>;

  constructor(url: string, responseType: T);
  cancel(): void;
}
```

- Constructor calls `fetch()` immediately with an internal
  `AbortController`'s signal
- `response` resolves with the parsed body (`string` for text,
  `ArrayBuffer` for arraybuffer)
- `cancel()` aborts the underlying fetch
- On cancel, `response` rejects with the native `DOMException`
  (AbortError) — controllers catch and remap this

### Error System — `lib/errors.ts`

A discriminated union where each error code carries typed data.

```typescript
enum ErrorCode {
  MANIFEST_LOAD_FAILED,
  MANIFEST_CANCELLED,
  SEGMENT_LOAD_FAILED,
  SEGMENT_CANCELLED,
}

type ErrorDataMap = {
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

type PlayerError<C extends ErrorCode = ErrorCode> = {
  code: C;
  fatal: boolean;
  data: ErrorDataMap[C];
};
```

When switching on `code`, TypeScript narrows `data`
automatically.

### Error Event — `lib/events.ts`

Add `ERROR` to `Events` and a typed event:

```typescript
export type ErrorEvent = {
  error: PlayerError;
};
```

Added to `EventMap`:
```typescript
[Events.ERROR]: (event: ErrorEvent) => void;
```

### StreamController Changes

**MediaState:** Replace `state: State` with
`request: Request<"arraybuffer"> | null`. The `State` enum
reduces to `STOPPED`, `IDLE`, `ENDED` — `LOADING` is expressed
as `request !== null`.

**`loadSegment_` / `loadInitSegment_`:** Create a `Request`,
store on `mediaState.request`. On completion: null the request,
emit `BUFFER_APPENDING`. On error: check if AbortError (ignore),
otherwise emit `Events.ERROR` with `SEGMENT_LOAD_FAILED` and
`fatal: true`.

**Seek handling:** Listen for the `seeking` event on the media
element. On seek, for each `MediaState`:
1. `request?.cancel()` — abort in-flight fetch
2. Null `request` and `lastSegment`
3. Set state to `IDLE`
4. Next tick picks up from new playhead position

**`destroy()`:** Cancel all in-flight requests.

### ManifestController Changes

Use `new Request(url, "text")` instead of bare `fetch()`. Store
the `Request` instance so `destroy()` can cancel it. On error:
emit `Events.ERROR` with `MANIFEST_LOAD_FAILED` and
`fatal: true`.

### Fatality Rules

Current (no retry/fallback):
- **Fatal:** manifest fetch failure, segment fetch failure —
  emitted via `Events.ERROR`
- **Cancellations:** controllers catch `AbortError` and emit
  `Events.ERROR` with `SEGMENT_CANCELLED` or
  `MANIFEST_CANCELLED` and `fatal: false`. This gives consumers
  visibility without treating it as a failure.

Future (with retry and quality fallback):
- Segment failures become non-fatal while retry/fallback
  strategies are available
- Fatal only after all strategies are exhausted (e.g., audio
  segment after N retries, video after quality downgrade fails)

## Data Flow

### Successful segment load
```
StreamController creates Request("url", "arraybuffer")
  → stores on mediaState.request
  → await request.response
  → null mediaState.request
  → emit BUFFER_APPENDING
```

### Seek during load
```
seeking event fires
  → StreamController iterates mediaStates
  → request.cancel() on each
  → null request, null lastSegment, state = IDLE
  → request.response rejects with AbortError
  → catch recognizes AbortError, does nothing
  → next tick: update_ runs from new position
```

### Segment fetch failure
```
fetch fails (404, network error)
  → request.response rejects
  → catch: not AbortError
  → emit Events.ERROR {
      error: {
        code: SEGMENT_LOAD_FAILED,
        fatal: true,
        data: { url, mediaType, status }
      }
    }
```
