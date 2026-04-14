# Network Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-request retry support to `NetworkService` by converting `NetworkRequest` to a class and implementing a retry loop in the service.

**Architecture:** `NetworkRequest` becomes a class owning its state and a symbol-keyed `AbortController`. The service gains a `nextAttempt_` method that bumps `attempt` and resets the controller, and a retry loop in `doFetch_` that calls it before each fetch attempt. `Promise.withResolvers` is used to create the request promise on the caller side.

**Tech Stack:** TypeScript, Vitest

**Spec:** [Network Retry Design](../specs/2026-04-14-network-retry-design.md)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/net/network_request.ts` | Create | `NetworkRequest` class + `ABORT_CONTROLLER` symbol |
| `lib/types/net.ts` | Modify | Add `NetworkRequestOptions`, re-export `NetworkRequest` class, remove old type + `cancelled` field |
| `lib/net/network_service.ts` | Modify | Retry loop, `nextAttempt_`, `Set<NetworkRequest>`, `Promise.withResolvers` |
| `lib/index.ts` | Modify | Add export for `net/network_request` |
| `lib/events.ts` | Modify | Update `NetworkRequest` import path |
| `lib/net/network_response.ts` | Modify | Update `NetworkRequest` import path |
| `lib/manifest/manifest_controller.ts` | Modify | Update `NetworkRequest` import path |
| `lib/media/stream_controller.ts` | Modify | Update `NetworkRequest` import path |
| `test/__framework__/factories.ts` | Modify | Add `createNetworkRequest` factory |
| `test/net/network_service.test.ts` | Create | Tests for network service + retry |

All paths relative to `packages/cmaf-lite/`.

---

### Task 1: Create `NetworkRequest` class

**Files:**
- Create: `lib/net/network_request.ts`
- Modify: `lib/types/net.ts`
- Modify: `lib/index.ts`

- [ ] **Step 1: Create the `NetworkRequest` class**

Create `lib/net/network_request.ts`:

```typescript
import type { NetworkResponsePromise } from "../types/net";

/**
 * Symbol-keyed abort controller, hidden from external callers.
 *
 * @internal
 */
export const ABORT_CONTROLLER = Symbol("abortController");

/**
 * Options for a network request.
 *
 * @public
 */
export type NetworkRequestOptions = {
  /** Total number of attempts (1 = no retry). */
  maxAttempts: number;
  /** Delay in milliseconds between retry attempts. */
  delay: number;
};

/**
 * Mutable request descriptor. Listeners can modify `url`, `method`,
 * and `headers` before each fetch attempt.
 *
 * @public
 */
export class NetworkRequest {
  method: "GET" | "POST" = "GET";
  headers = new Headers();
  inFlight = true;
  attempt = 0;
  [ABORT_CONTROLLER] = new AbortController();

  constructor(
    public url: string,
    public readonly promise: NetworkResponsePromise,
    public readonly options: NetworkRequestOptions = {
      maxAttempts: 1,
      delay: 0,
    },
  ) {}
}
```

- [ ] **Step 2: Update `lib/types/net.ts`**

Remove the `NetworkRequest` type and `cancelled` field. Re-export the class. Keep `ABORTED`, `NetworkResponsePromise`, and `NetworkRequestType`:

```typescript
import type { NetworkResponse } from "../net/network_response";

export { NetworkRequest, ABORT_CONTROLLER } from "../net/network_request";
export type { NetworkRequestOptions } from "../net/network_request";

/**
 * Categorizes a network request for event listeners.
 *
 * @public
 */
export enum NetworkRequestType {
  MANIFEST = "manifest",
  SEGMENT = "segment",
}

/**
 * Sentinel returned when a request is cancelled via
 * {@link NetworkService.cancel}.
 *
 * @public
 */
export const ABORTED: unique symbol = Symbol("ABORTED");

/**
 * Promise that resolves to a {@link NetworkResponse} or {@link ABORTED}
 * if the request was cancelled.
 *
 * @public
 */
export type NetworkResponsePromise = Promise<NetworkResponse | typeof ABORTED>;
```

- [ ] **Step 3: Add export to `lib/index.ts`**

Add the `network_request` export:

```typescript
export * from "./net/network_request";
```

- [ ] **Step 4: Update imports across the codebase**

These files import `NetworkRequest` from `../types/net` or `../../types/net`. Since `types/net.ts` re-exports the class, the imports still resolve. However, update `lib/net/network_response.ts` to import directly from the sibling module:

In `lib/net/network_response.ts`, change:
```typescript
import type { NetworkRequest } from "../types/net";
```
to:
```typescript
import type { NetworkRequest } from "./network_request";
```

- [ ] **Step 5: Run type check**

Run: `pnpm tsc`

Expected: No errors. All existing code compiles because the class has the same public shape as the old type (minus `cancelled` which is never read).

- [ ] **Step 6: Commit**

```bash
git add packages/cmaf-lite/lib/net/network_request.ts \
       packages/cmaf-lite/lib/types/net.ts \
       packages/cmaf-lite/lib/index.ts \
       packages/cmaf-lite/lib/net/network_response.ts
git commit -m "refactor: Extract NetworkRequest into a class"
```

---

### Task 2: Refactor `NetworkService` to use the new `NetworkRequest` class

**Files:**
- Modify: `lib/net/network_service.ts`

- [ ] **Step 1: Write the failing test — service creates a `NetworkRequest` instance**

Create `test/net/network_service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NetworkService } from "../../lib/net/network_service";
import { NetworkRequest } from "../../lib/net/network_request";
import { ABORTED, NetworkRequestType } from "../../lib/types/net";
import type { Player } from "../../lib/player";

function createMockPlayer(): Player {
  return {
    emit: vi.fn(),
    getNetworkService: vi.fn(),
  } as unknown as Player;
}

describe("NetworkService", () => {
  let player: Player;
  let service: NetworkService;

  beforeEach(() => {
    player = createMockPlayer();
    service = new NetworkService(player);
  });

  it("returns a NetworkRequest instance", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("ok", { status: 200 }),
        ),
      ),
    );

    const request = service.request(
      NetworkRequestType.SEGMENT,
      "https://cdn.test/seg.m4s",
    );

    expect(request).toBeInstanceOf(NetworkRequest);
    expect(request.url).toBe("https://cdn.test/seg.m4s");
    expect(request.attempt).toBe(0);
    expect(request.inFlight).toBe(true);
    expect(request.promise).toBeInstanceOf(Promise);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: FAIL — `service.request()` returns a plain object, not a `NetworkRequest` instance.

- [ ] **Step 3: Refactor `NetworkService`**

Rewrite `lib/net/network_service.ts`:

```typescript
import { Events } from "../events";
import type { Player } from "../player";
import {
  ABORT_CONTROLLER,
  NetworkRequest,
} from "./network_request";
import type { NetworkRequestOptions } from "./network_request";
import { NetworkResponse } from "./network_response";
import { ABORTED, NetworkRequestType } from "../types/net";
import type { NetworkResponsePromise } from "../types/net";

/**
 * Central service for all network requests. Owns fetch execution,
 * retry logic, and cancellation.
 *
 * @public
 */
export class NetworkService {
  private requests_ = new Set<NetworkRequest>();

  constructor(private player_: Player) {}

  /**
   * Creates and starts an HTTP request. Emits |NETWORK_REQUEST|
   * before each attempt, allowing listeners to mutate the request.
   */
  request(
    type: NetworkRequestType,
    url: string,
    options?: NetworkRequestOptions,
  ): NetworkRequest {
    const promiseWithResolvers =
      Promise.withResolvers<
        Awaited<NetworkResponsePromise>
      >();

    const request = new NetworkRequest(
      url,
      promiseWithResolvers.promise,
      options,
    );

    this.requests_.add(request);
    this.doFetch_(type, request, promiseWithResolvers);

    return request;
  }

  /**
   * Aborts an in-flight request. No-op if already completed or
   * cancelled.
   */
  cancel(request: NetworkRequest) {
    request.inFlight = false;
    request[ABORT_CONTROLLER].abort();
    this.requests_.delete(request);
  }

  private async doFetch_(
    type: NetworkRequestType,
    request: NetworkRequest,
    promiseWithResolvers: PromiseWithResolvers<
      Awaited<NetworkResponsePromise>
    >,
  ) {
    try {
      while (request.attempt < request.options.maxAttempts) {
        this.nextAttempt_(request);

        this.player_.emit(Events.NETWORK_REQUEST, {
          type,
          request,
        });

        try {
          const response = await this.fetch_(request);

          this.player_.emit(Events.NETWORK_RESPONSE, {
            type,
            response,
          });

          promiseWithResolvers.resolve(response);
          return;
        } catch (error) {
          if (isAbortError(error)) {
            promiseWithResolvers.resolve(ABORTED);
            return;
          }

          if (request.attempt >= request.options.maxAttempts) {
            promiseWithResolvers.reject(error);
            return;
          }

          await delay(request.options.delay);
        }
      }
    } finally {
      request.inFlight = false;
      this.requests_.delete(request);
    }
  }

  /**
   * Prepares the request for its next attempt.
   */
  private nextAttempt_(request: NetworkRequest) {
    request.attempt += 1;
    request[ABORT_CONTROLLER] = new AbortController();
  }

  private async fetch_(request: NetworkRequest): Promise<NetworkResponse> {
    const start = performance.now();

    const res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      signal: request[ABORT_CONTROLLER].signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.arrayBuffer();
    const timeElapsed = performance.now() - start;

    return new NetworkResponse(
      request,
      res.status,
      res.headers,
      timeElapsed,
      data,
    );
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: PASS

- [ ] **Step 5: Run full type check and test suite**

Run: `pnpm tsc && pnpm test`

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cmaf-lite/lib/net/network_service.ts \
       packages/cmaf-lite/test/net/network_service.test.ts
git commit -m "refactor: Use NetworkRequest class in NetworkService"
```

---

### Task 3: Test the retry loop

**Files:**
- Modify: `test/net/network_service.test.ts`

- [ ] **Step 1: Write test — successful fetch resolves the promise**

Add to the `NetworkService` describe block:

```typescript
it("resolves with NetworkResponse on successful fetch", async () => {
  const body = new ArrayBuffer(1024);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
      ),
    ),
  );

  const request = service.request(
    NetworkRequestType.SEGMENT,
    "https://cdn.test/seg.m4s",
  );

  const response = await request.promise;
  expect(response).not.toBe(ABORTED);
  if (response === ABORTED) return;

  expect(response.status).toBe(200);
  expect(response.arrayBuffer.byteLength).toBe(1024);
  expect(request.attempt).toBe(1);
  expect(request.inFlight).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: PASS (this should already work with the implementation from Task 2).

- [ ] **Step 3: Write test — retries on failure and succeeds**

```typescript
it("retries on HTTP error and resolves on subsequent success", async () => {
  const body = new ArrayBuffer(512);
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("HTTP 503 Service Unavailable"))
    .mockResolvedValueOnce(
      new Response(body, { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const request = service.request(
    NetworkRequestType.SEGMENT,
    "https://cdn.test/seg.m4s",
    { maxAttempts: 3, delay: 0 },
  );

  const response = await request.promise;
  expect(response).not.toBe(ABORTED);
  if (response === ABORTED) return;

  expect(response.status).toBe(200);
  expect(request.attempt).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: PASS

- [ ] **Step 5: Write test — exhausts all attempts and rejects**

```typescript
it("rejects after exhausting all retry attempts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.reject(new Error("HTTP 500 Internal Server Error")),
    ),
  );

  const request = service.request(
    NetworkRequestType.SEGMENT,
    "https://cdn.test/seg.m4s",
    { maxAttempts: 2, delay: 0 },
  );

  await expect(request.promise).rejects.toThrow("HTTP 500");
  expect(request.attempt).toBe(2);
  expect(request.inFlight).toBe(false);
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: PASS

- [ ] **Step 7: Write test — emits NETWORK_REQUEST before each attempt**

```typescript
it("emits NETWORK_REQUEST before each attempt", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("HTTP 503 Service Unavailable"))
    .mockResolvedValueOnce(
      new Response(new ArrayBuffer(0), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const request = service.request(
    NetworkRequestType.SEGMENT,
    "https://cdn.test/seg.m4s",
    { maxAttempts: 2, delay: 0 },
  );

  await request.promise;

  const emitMock = player.emit as ReturnType<typeof vi.fn>;
  const networkRequestCalls = emitMock.mock.calls.filter(
    ([event]: [string]) => event === "networkRequest",
  );

  expect(networkRequestCalls).toHaveLength(2);
  expect(networkRequestCalls[0][1].request.attempt).toBe(1);
  expect(networkRequestCalls[1][1].request.attempt).toBe(2);
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: PASS

- [ ] **Step 9: Write test — cancel resolves with ABORTED**

```typescript
it("resolves with ABORTED when cancelled", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () => new Promise(() => {}), // never resolves
    ),
  );

  const request = service.request(
    NetworkRequestType.SEGMENT,
    "https://cdn.test/seg.m4s",
  );

  service.cancel(request);

  const response = await request.promise;
  expect(response).toBe(ABORTED);
  expect(request.inFlight).toBe(false);
});
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: PASS

- [ ] **Step 11: Write test — delay between retries**

```typescript
it("waits the configured delay between retry attempts", async () => {
  vi.useFakeTimers();

  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("HTTP 503 Service Unavailable"))
    .mockResolvedValueOnce(
      new Response(new ArrayBuffer(0), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const request = service.request(
    NetworkRequestType.SEGMENT,
    "https://cdn.test/seg.m4s",
    { maxAttempts: 2, delay: 1000 },
  );

  // First attempt fails, waiting for delay
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // Advance past the delay
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  await request.promise;

  vi.useRealTimers();
});
```

- [ ] **Step 12: Run all tests**

Run: `pnpm --filter cmaf-lite test -- test/net/network_service.test.ts`

Expected: All PASS

- [ ] **Step 13: Commit**

```bash
git add packages/cmaf-lite/test/net/network_service.test.ts
git commit -m "test: Add NetworkService retry tests"
```

---

### Task 4: Format, lint, and final validation

**Files:** None new

- [ ] **Step 1: Run formatter**

Run: `pnpm format`

- [ ] **Step 2: Run full type check**

Run: `pnpm tsc`

Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `pnpm test`

Expected: All pass.

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A
git commit -m "chore: Format"
```

Only commit if there are changes. Skip if clean.
