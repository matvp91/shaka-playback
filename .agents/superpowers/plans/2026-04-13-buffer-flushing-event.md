# BUFFER_FLUSHING Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the stream-switch buffer flush from a direct `Player → BufferController.flush()` call to an event-driven `StreamController → BUFFER_FLUSHING → BufferController` flow, so the flush decision lives next to the switch decision.

**Architecture:** Introduce a new `BUFFER_FLUSHING` event (request) paired with the existing `BUFFER_FLUSHED` (notification). `StreamController` emits it from `onStreamPreferenceChanged_` on the real-switch path, gated by the new `flushBuffer` flag on `STREAM_PREFERENCE_CHANGED` and the existing `isAV`. `BufferController` listens and runs its flush. `Player.setStreamPreference` becomes a pure event emitter. `BufferController.flush` is renamed to a private `flush_` to enforce the event boundary.

**Tech Stack:** TypeScript, Vitest (happy-dom), pnpm workspaces, Biome.

**Spec:** [.agents/superpowers/2026-04-13-buffer-flushing-event-design.md](../2026-04-13-buffer-flushing-event-design.md)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `packages/cmaf-lite/lib/events.ts` | Add `BUFFER_FLUSHING` event constant + `BufferFlushingEvent` type; add `flushBuffer?: boolean` to `StreamPreferenceChangedEvent` |
| Modify | `packages/cmaf-lite/lib/media/buffer_controller.ts` | Register listener for `BUFFER_FLUSHING`; rename `flush` → `flush_` (private) |
| Modify | `packages/cmaf-lite/lib/media/stream_controller.ts` | Emit `BUFFER_FLUSHING` on switch path when `event.flushBuffer && isAV(type)` |
| Modify | `packages/cmaf-lite/lib/player.ts` | Drop direct `bufferController_.flush(...)` call; forward `flushBuffer` through the event |

---

## Task 1: Add event type and payload extension

**Files:**
- Modify: `packages/cmaf-lite/lib/events.ts`

- [ ] **Step 1: Add `BUFFER_FLUSHING` event constant**

In `packages/cmaf-lite/lib/events.ts`, update the `Events` constant object. Insert `BUFFER_FLUSHING` adjacent to `BUFFER_FLUSHED` (the existing notification pair):

```ts
export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHED: "mediaDetached",
  BUFFER_CODECS: "bufferCodecs",
  BUFFER_APPENDING: "bufferAppending",
  BUFFER_APPENDED: "bufferAppended",
  BUFFER_EOS: "bufferEos",
  BUFFER_FLUSHING: "bufferFlushing",
  BUFFER_FLUSHED: "bufferFlushed",
  BUFFER_APPEND_ERROR: "bufferAppendError",
  NETWORK_REQUEST: "networkRequest",
  NETWORK_RESPONSE: "networkResponse",
  STREAM_PREFERENCE_CHANGED: "streamPreferenceChanged",
} as const;
```

- [ ] **Step 2: Add `BufferFlushingEvent` payload type**

Immediately before the existing `BufferFlushedEvent` declaration (around line 114-121), add:

```ts
/**
 * Fired to request a SourceBuffer flush. Paired with
 * {@link BufferFlushedEvent}, which fires after the flush completes.
 *
 * @public
 */
export type BufferFlushingEvent = {
  type: SourceBufferMediaType;
};
```

- [ ] **Step 3: Extend `StreamPreferenceChangedEvent` payload**

Locate `StreamPreferenceChangedEvent` (around line 150). Add `flushBuffer?: boolean`:

```ts
/**
 * Fired when {@link Player.setStreamPreference} changed the active stream
 * preference.
 *
 * @public
 */
export type StreamPreferenceChangedEvent = {
  preference: StreamPreference;
  flushBuffer?: boolean;
};
```

- [ ] **Step 4: Register listener signature in `EventMap`**

In the `EventMap` interface, add an entry for `BUFFER_FLUSHING` alongside `BUFFER_FLUSHED`:

```ts
export interface EventMap {
  [Events.MANIFEST_LOADING]: (event: ManifestLoadingEvent) => void;
  [Events.MANIFEST_PARSED]: (event: ManifestParsedEvent) => void;
  [Events.MEDIA_ATTACHING]: (event: MediaAttachingEvent) => void;
  [Events.MEDIA_ATTACHED]: (event: MediaAttachedEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
  [Events.BUFFER_CODECS]: (event: BufferCodecsEvent) => void;
  [Events.BUFFER_APPENDING]: (event: BufferAppendingEvent) => void;
  [Events.BUFFER_APPENDED]: (event: BufferAppendedEvent) => void;
  [Events.BUFFER_EOS]: undefined;
  [Events.BUFFER_FLUSHING]: (event: BufferFlushingEvent) => void;
  [Events.BUFFER_APPEND_ERROR]: (event: BufferAppendErrorEvent) => void;
  [Events.BUFFER_FLUSHED]: (event: BufferFlushedEvent) => void;
  [Events.NETWORK_REQUEST]: (event: NetworkRequestEvent) => void;
  [Events.NETWORK_RESPONSE]: (event: NetworkResponseEvent) => void;
  [Events.STREAM_PREFERENCE_CHANGED]: (
    event: StreamPreferenceChangedEvent,
  ) => void;
}
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter cmaf-lite tsc`
Expected: PASS. All changes are additive; no consumers use the new event or payload field yet.

- [ ] **Step 6: Commit**

```bash
git add packages/cmaf-lite/lib/events.ts
git commit -m "$(cat <<'EOF'
feat: add BUFFER_FLUSHING event and flushBuffer payload field

Introduces the request-side event paired with BUFFER_FLUSHED and
extends STREAM_PREFERENCE_CHANGED so the flushBuffer intent can flow
from the public API into StreamController.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: BufferController listens for BUFFER_FLUSHING

**Files:**
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts`

- [ ] **Step 1: Add imports and listener registration**

Open `packages/cmaf-lite/lib/media/buffer_controller.ts`. Add `BufferFlushingEvent` to the event imports at the top of the file (alongside other event types already imported). Then, in the constructor where other `player_.on(...)` calls live, register:

```ts
this.player_.on(Events.BUFFER_FLUSHING, this.onBufferFlushing_);
```

In `destroy` (where other `player_.off(...)` calls live), mirror it:

```ts
this.player_.off(Events.BUFFER_FLUSHING, this.onBufferFlushing_);
```

- [ ] **Step 2: Add the handler**

Add a new private handler method (arrow-function field to match existing handler style):

```ts
private onBufferFlushing_ = (event: BufferFlushingEvent) => {
  this.flush(event.type);
};
```

`flush` remains public for this task — the rename happens in Task 4 after all callers are migrated.

- [ ] **Step 3: Type-check and test**

Run: `pnpm --filter cmaf-lite tsc`
Expected: PASS.

Run: `pnpm --filter cmaf-lite test`
Expected: PASS (no test regressions; nothing emits `BUFFER_FLUSHING` yet).

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/media/buffer_controller.ts
git commit -m "$(cat <<'EOF'
feat(buffer-controller): listen for BUFFER_FLUSHING event

Registers a handler that delegates to the existing flush method.
No behavior change until StreamController starts emitting the event.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Swap flush source from Player to StreamController

**Files:**
- Modify: `packages/cmaf-lite/lib/player.ts`
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts`

This task swaps the flush trigger atomically: Player stops calling `bufferController_.flush` and instead forwards the flag in the event; StreamController reads the flag and emits `BUFFER_FLUSHING` on the real-switch path. The two edits must land together for a coherent commit — without StreamController emitting, the flush wouldn't happen; without Player forwarding, StreamController wouldn't know whether to emit.

- [ ] **Step 1: Simplify `Player.setStreamPreference`**

Open `packages/cmaf-lite/lib/player.ts`. Locate `setStreamPreference` (around line 117):

```ts
setStreamPreference(preference: StreamPreference, flushBuffer?: boolean) {
  this.emit(Events.STREAM_PREFERENCE_CHANGED, { preference });
  if (flushBuffer && preference.type !== MediaType.TEXT) {
    this.bufferController_.flush(preference.type);
  }
}
```

Replace with:

```ts
setStreamPreference(preference: StreamPreference, flushBuffer?: boolean) {
  this.emit(Events.STREAM_PREFERENCE_CHANGED, { preference, flushBuffer });
}
```

After the edit, `MediaType` may no longer be used in `player.ts` outside this method. Leave the import alone if it's used elsewhere (verify by search); remove the import only if `MediaType` is no longer referenced in the file.

- [ ] **Step 2: Emit `BUFFER_FLUSHING` from `StreamController`**

Open `packages/cmaf-lite/lib/media/stream_controller.ts`. Locate `onStreamPreferenceChanged_`. Find the block after the codec-change check where the switch is committed (look for `log.info("Switched stream", stream);`). Insert the `BUFFER_FLUSHING` emit between `mediaState.lastInitSegment = null;` and `this.update_(mediaState);`:

```ts
log.info("Switched stream", stream);
mediaState.stream = stream;
mediaState.lastSegment = null;
mediaState.lastInitSegment = null;

if (event.flushBuffer && isAV(mediaState.type)) {
  this.player_.emit(Events.BUFFER_FLUSHING, { type: mediaState.type });
}

this.update_(mediaState);
```

Placement is intentional:
- After the `stream === mediaState.stream` early-return, so no-op switches do not flush.
- After `mediaState.stream = stream`, so downstream consumers observe post-switch state.
- Before `this.update_(mediaState)`, so the flush is enqueued before fetching new segments.

- [ ] **Step 3: Type-check and test**

Run: `pnpm --filter cmaf-lite tsc`
Expected: PASS.

Run: `pnpm --filter cmaf-lite test`
Expected: PASS. No existing tests poke at `bufferController.flush` directly from the preference-change path, so existing suites stay green.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/player.ts packages/cmaf-lite/lib/media/stream_controller.ts
git commit -m "$(cat <<'EOF'
refactor: route stream-switch flush through BUFFER_FLUSHING

Player.setStreamPreference becomes a pure event emitter. StreamController
emits BUFFER_FLUSHING on the real-switch path, gated by flushBuffer and
isAV, co-located with the switch decision.

Behavior change: a preference change that does not cause a switch
(same stream selected) no longer flushes, even with flushBuffer=true.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Make `BufferController.flush` private

**Files:**
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts`

- [ ] **Step 1: Confirm no external callers remain**

Run: `grep -rn "bufferController_.flush\|bufferController\.flush\b" packages/ --include="*.ts" --exclude-dir=dist --exclude-dir=node_modules`
Expected: zero matches outside `packages/cmaf-lite/lib/media/buffer_controller.ts` itself.

If any match exists outside that file, stop and escalate — Task 3 missed a call site.

- [ ] **Step 2: Rename to private `flush_`**

In `packages/cmaf-lite/lib/media/buffer_controller.ts`, locate the `flush` method (around line 70):

```ts
flush(type: SourceBufferMediaType) {
  const sb = this.sourceBuffers_.get(type);
  asserts.assertExists(sb, `No SourceBuffer for ${type}`);
  this.quotaEvictionPending_.delete(type);
  this.opQueue_.enqueue(type, {
    kind: OperationKind.Flush,
    execute: () => {
      sb.remove(0, Infinity);
      this.player_.emit(Events.BUFFER_FLUSHED, { type });
    },
  });
}
```

Rename to `private flush_(type: SourceBufferMediaType)`:

```ts
private flush_(type: SourceBufferMediaType) {
  const sb = this.sourceBuffers_.get(type);
  asserts.assertExists(sb, `No SourceBuffer for ${type}`);
  this.quotaEvictionPending_.delete(type);
  this.opQueue_.enqueue(type, {
    kind: OperationKind.Flush,
    execute: () => {
      sb.remove(0, Infinity);
      this.player_.emit(Events.BUFFER_FLUSHED, { type });
    },
  });
}
```

Update the call site in `onBufferFlushing_`:

```ts
private onBufferFlushing_ = (event: BufferFlushingEvent) => {
  this.flush_(event.type);
};
```

- [ ] **Step 3: Type-check, test, format**

Run: `pnpm --filter cmaf-lite tsc`
Expected: PASS.

Run: `pnpm --filter cmaf-lite test`
Expected: PASS.

Run: `pnpm --filter cmaf-lite format`
Expected: no substantive changes.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/media/buffer_controller.ts
git commit -m "$(cat <<'EOF'
refactor(buffer-controller): make flush private

The only caller outside the class is now the BUFFER_FLUSHING handler.
Renaming to flush_ (private) enforces the event boundary at compile time.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Verification

**Files:** none

- [ ] **Step 1: Package type-check**

Run: `pnpm --filter cmaf-lite tsc`
Expected: PASS.

- [ ] **Step 2: Package tests**

Run: `pnpm --filter cmaf-lite test`
Expected: PASS (105 tests or more if new tests were added).

- [ ] **Step 3: Package format/lint**

Run: `pnpm --filter cmaf-lite format`
Expected: no substantive changes.

- [ ] **Step 4: Package build**

Run: `pnpm --filter cmaf-lite build`
Expected: PASS. Bundle sizes nominal.

- [ ] **Step 5: Manual smoke**

Run: `pnpm dev` from the repo root.

Exercise in the demo UI:
- Load a stream.
- Change video stream preference with the "flush" option enabled in the demo's stream selector — verify playback resumes from the new position with the new stream, and that the browser's Network panel shows the old segments replaced.
- Change audio stream preference similarly.
- Change to the *same* preference again with flush enabled — verify no network hiccup (this is the intentional behavior change: no-op switches no longer flush).

If any step fails, investigate and file findings before marking the branch complete.

- [ ] **Step 6: Log result**

Confirm the branch has four new commits (Tasks 1–4) on top of the earlier stream-controller simplification. Ready for review.

---

## Testing Notes

The spec lists unit tests for the emit logic in `StreamController` and the
listener in `BufferController`. The repo has no existing test harness for
either controller (only `test/media/operation_queue.test.ts` and
`test/media/segment_tracker.test.ts` exist, both for leaf utilities).
Building that harness would expand this plan's scope significantly —
mocking `Player`, `NetworkService`, and the MSE surface, none of which have
existing test patterns.

**Decision**: rely on the manual smoke in Task 5 Step 5 for end-to-end
verification, plus `pnpm --filter cmaf-lite tsc` / `test` to catch
regressions in currently-covered surfaces (utils, parsing, operation queue,
segment tracker). A follow-up plan to stand up `StreamController` /
`BufferController` unit tests is a good next step but is out of scope here.

If the reviewer disagrees, the smallest addition would be a
`buffer_controller.test.ts` that instantiates a `BufferController` with a
mock `Player` (EventEmitter-backed), emits `BUFFER_FLUSHING`, and asserts
`sourceBuffer.remove(0, Infinity)` is invoked. That's 1–2 hours of harness
work for a single assertion.

---

## Regression Checklist (for reviewer)

- [ ] `Player.setStreamPreference` no longer imports or references `SourceBufferMediaType` (unless used elsewhere in the file).
- [ ] `BufferController.flush_` is private; no callers outside the class.
- [ ] `STREAM_PREFERENCE_CHANGED` carries `flushBuffer` when the caller requested one.
- [ ] `BUFFER_FLUSHING` is emitted only on the real-switch path in `onStreamPreferenceChanged_` (after `lastSegment`/`lastInitSegment` are cleared, before `update_`).
- [ ] `isAV` gate applied so TEXT does not emit `BUFFER_FLUSHING`.
- [ ] `BufferController` registers and tears down the `BUFFER_FLUSHING` listener symmetrically in constructor and `destroy`.
