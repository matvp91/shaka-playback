# Network Retry

Add a retry mechanism to `NetworkService` with per-request configuration.

## Goals

- Callers opt in to retry by passing `NetworkRequestOptions` when creating a request
- Retry logic is transparent — owned by the service, not the caller
- `NetworkRequest` becomes a class that owns its own state and abort controller
- Simplify `NetworkService` by moving lifecycle state into the request

## Types

### `NetworkRequestOptions`

Defined in `types/net.ts`:

```typescript
type NetworkRequestOptions = {
  maxAttempts: number;
  delay: number; // ms between retries
};
```

### `NetworkRequest` class

Replaces the current object literal. Lives in `net/network_request.ts`.

```typescript
export const ABORT_CONTROLLER = Symbol("abortController");

class NetworkRequest {
  method: "GET" | "POST" = "GET";
  headers = new Headers();
  inFlight = true;
  attempt = 0;
  [ABORT_CONTROLLER] = new AbortController();

  constructor(
    public url: string,
    public readonly promise: NetworkResponsePromise,
    public readonly options: NetworkRequestOptions = { maxAttempts: 1, delay: 0 },
  ) {}
}
```

Key decisions:

- `promise` is passed in by the service — no `!` assertion needed
- `attempt` starts at 0 — incremented to 1 on first attempt by `nextAttempt_()`
- `options` is readonly with defaults: `maxAttempts = 1`, `delay = 0` (no retry)
- `ABORT_CONTROLLER` is symbol-keyed — hidden from external callers
- `inFlight` stays `true` during retries, only `false` on final resolution
- The `NetworkRequest` type in `types/net.ts` becomes a re-export of the class

### `NetworkResponsePromise`

Unchanged — `Promise<NetworkResponse | typeof ABORTED>`.

### `ABORTED` sentinel

Unchanged. Callers check `result === ABORTED` on the promise. The `cancelled`
field is removed — abort state lives solely in the hidden abort controller.

## Events

### `NETWORK_REQUEST`

Fires before **every** attempt (initial + retries). Listeners inspect
`request.attempt` to distinguish first try from retries. Listeners can
still mutate `url`, `method`, `headers` before each attempt.

### `NETWORK_RESPONSE`

Fires once on final success only. Unchanged payload.

## `NetworkService` changes

### `request()` signature

```typescript
request(type: NetworkRequestType, url: string, options?: NetworkRequestOptions): NetworkRequest
```

The service creates `promiseWithResolvers = Promise.withResolvers()`, passes
`promiseWithResolvers.promise` into the `NetworkRequest` constructor, and
passes `promiseWithResolvers` to `doFetch_`.

### Internal state

- `controllers_: Map<NetworkRequest, AbortController>` → `requests_: Set<NetworkRequest>`
- Abort controller accessed via `request[ABORT_CONTROLLER]`

### `nextAttempt_()` — private method

Prepares a request for its next attempt:

```typescript
private nextAttempt_(request: NetworkRequest) {
  request.attempt += 1;
  request[ABORT_CONTROLLER] = new AbortController();
}
```

Handles both initial attempt and retries uniformly — no special case.

### `doFetch_` retry loop

```
doFetch_(type, request, promiseWithResolvers):
  while request.attempt < request.options.maxAttempts:
    nextAttempt_(request)
    emit NETWORK_REQUEST
    try fetch with request[ABORT_CONTROLLER].signal
      on success: emit NETWORK_RESPONSE, promiseWithResolvers.resolve(response)
      on abort error: promiseWithResolvers.resolve(ABORTED)
      on other error:
        if last attempt: promiseWithResolvers.reject(error)
        wait request.options.delay ms
  finally:
    request.inFlight = false
    requests_.delete(request)
```

### `cancel()`

```typescript
cancel(request: NetworkRequest) {
  request.inFlight = false;
  request[ABORT_CONTROLLER].abort();
  this.requests_.delete(request);
}
```

## Out of scope

- Exponential backoff (separate feature)
- Per-status-code retry decisions
- Error event/type system
- ABR controller (next design)
