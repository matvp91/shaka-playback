# Buffer Controller Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three targeted cleanups: (1) `sourceopen` listener becomes a stable bound method without `{ once: true }`, (2) the `MediaSource` object URL is revoked on detach via a new `MEDIA_DETACHING` event, (3) `SegmentTracker.reconcile` compacts in place instead of allocating a new array.

**Architecture:** Add `MEDIA_DETACHING` as a symmetric counterpart to `MEDIA_ATTACHING`; `Player.detachMedia` fires it with the media element before clearing `media_`. `BufferController` stores the object URL on a private field and revokes it in the new handler. `SegmentTracker.reconcile` switches to two-pointer in-place filtering.

**Tech Stack:** TypeScript, Vitest (happy-dom), pnpm workspaces, Biome.

**Spec:** [.agents/superpowers/specs/2026-04-13-buffer-controller-cleanup-design.md](../specs/2026-04-13-buffer-controller-cleanup-design.md)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `packages/cmaf-lite/lib/events.ts` | Add `MEDIA_DETACHING` event constant, `MediaDetachingEvent` type, and `EventMap` entry |
| Modify | `packages/cmaf-lite/lib/player.ts` | Emit `MEDIA_DETACHING` in `detachMedia()` before clearing `media_` |
| Modify | `packages/cmaf-lite/lib/media/buffer_controller.ts` | Bound `onMediaSourceOpen_`; store `objectUrl_`; `onMediaDetaching_` revokes it |
| Modify | `packages/cmaf-lite/lib/media/segment_tracker.ts` | In-place two-pointer compaction in `reconcile` |
| Modify | `packages/cmaf-lite/test/media/segment_tracker.test.ts` | Add test asserting reconcile mutates the same array instance |

---

## Task 1: Add `MEDIA_DETACHING` event

**Files:**
- Modify: `packages/cmaf-lite/lib/events.ts`

- [ ] **Step 1: Add event constant**

In `packages/cmaf-lite/lib/events.ts`, update the `Events` object to include `MEDIA_DETACHING` right before `MEDIA_DETACHED`:

```ts
export const Events = {
  MANIFEST_LOADING: "manifestLoading",
  MANIFEST_PARSED: "manifestParsed",
  MEDIA_ATTACHING: "mediaAttaching",
  MEDIA_ATTACHED: "mediaAttached",
  MEDIA_DETACHING: "mediaDetaching",
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

- [ ] **Step 2: Add `MediaDetachingEvent` type**

Immediately after the existing `MediaAttachedEvent` type declaration, add:

```ts
/**
 * Fired when {@link Player.detachMedia} is called, before the media element
 * is detached. Listeners can perform detach-time cleanup that needs access
 * to the media element.
 *
 * @public
 */
export type MediaDetachingEvent = {
  media: HTMLMediaElement;
};
```

- [ ] **Step 3: Add `EventMap` entry**

In the `EventMap` interface, add the new line directly above the existing `MEDIA_DETACHED` line:

```ts
  [Events.MEDIA_DETACHING]: (event: MediaDetachingEvent) => void;
  [Events.MEDIA_DETACHED]: undefined;
```

- [ ] **Step 4: Type-check**

Run: `pnpm tsc`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/events.ts
git commit -m "feat(events): add MEDIA_DETACHING event"
```

---

## Task 2: Fire `MEDIA_DETACHING` from `Player.detachMedia`

**Files:**
- Modify: `packages/cmaf-lite/lib/player.ts:140-143`

- [ ] **Step 1: Update `detachMedia`**

Replace the body of `detachMedia()` with:

```ts
  detachMedia() {
    if (this.media_) {
      this.emit(Events.MEDIA_DETACHING, { media: this.media_ });
    }
    this.media_ = null;
    this.emit(Events.MEDIA_DETACHED);
  }
```

`MEDIA_DETACHING` is emitted first (with the media reference), and only then is `media_` cleared and `MEDIA_DETACHED` emitted.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc`
Expected: PASS.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: PASS (no existing test asserts detach ordering; existing `MEDIA_DETACHED` subscribers continue to receive their event).

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/player.ts
git commit -m "feat(player): emit MEDIA_DETACHING before detach"
```

---

## Task 3: Bound `sourceopen` listener in `BufferController`

**Files:**
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts:84-101`

- [ ] **Step 1: Refactor `onMediaAttaching_` and add `onMediaSourceOpen_`**

Replace the existing `onMediaAttaching_` method with the two methods below. The previous `event.media` closure is gone — `onMediaSourceOpen_` reads the media element via `this.player_.getMedia()`.

```ts
  private onMediaAttaching_ = (event: MediaAttachingEvent) => {
    this.mediaSource_ = new MediaSource();
    this.mediaSource_.addEventListener("sourceopen", this.onMediaSourceOpen_);
    event.media.src = URL.createObjectURL(this.mediaSource_);
  };

  private onMediaSourceOpen_ = () => {
    asserts.assertExists(this.mediaSource_, "No MediaSource");
    this.mediaSource_.removeEventListener(
      "sourceopen",
      this.onMediaSourceOpen_,
    );
    const media = this.player_.getMedia();
    asserts.assertExists(media, "No media element");
    this.player_.emit(Events.MEDIA_ATTACHED, {
      media,
      mediaSource: this.mediaSource_,
    });
    this.updateDuration_();
  };
```

Notes:
- Arrow class fields give a stable bound reference, suitable for both `addEventListener` and `removeEventListener`.
- `removeEventListener` is called at the top of `onMediaSourceOpen_` to replace the removed `{ once: true }` option — older embedded devices do not support it reliably.
- `URL.createObjectURL` is still inlined here; Task 4 moves it onto `this.objectUrl_`.

- [ ] **Step 2: Type-check and run tests**

Run: `pnpm tsc && pnpm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/media/buffer_controller.ts
git commit -m "refactor(buffer_controller): bound sourceopen listener, drop { once: true }"
```

---

## Task 4: Track and revoke the object URL

**Files:**
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts`

- [ ] **Step 1: Add `objectUrl_` field**

In the `BufferController` class, directly after the `manifest_` field declaration, add:

```ts
  private objectUrl_: string | null = null;
```

- [ ] **Step 2: Subscribe to and unsubscribe from `MEDIA_DETACHING`**

In the constructor, add the subscription immediately after the existing `MEDIA_ATTACHING` subscription:

```ts
    this.player_.on(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.on(Events.MEDIA_DETACHING, this.onMediaDetaching_);
```

In `destroy()`, add the matching unsubscribe immediately after the existing `MEDIA_ATTACHING` unsubscribe:

```ts
    this.player_.off(Events.MEDIA_ATTACHING, this.onMediaAttaching_);
    this.player_.off(Events.MEDIA_DETACHING, this.onMediaDetaching_);
```

- [ ] **Step 3: Assign `objectUrl_` on attach**

In `onMediaAttaching_`, replace the line `event.media.src = URL.createObjectURL(this.mediaSource_);` with:

```ts
    this.objectUrl_ = URL.createObjectURL(this.mediaSource_);
    event.media.src = this.objectUrl_;
```

- [ ] **Step 4: Add the detaching handler**

Add this new class field next to the other bound handlers (e.g., directly after `onMediaSourceOpen_`):

```ts
  private onMediaDetaching_ = () => {
    if (this.objectUrl_) {
      URL.revokeObjectURL(this.objectUrl_);
      this.objectUrl_ = null;
    }
  };
```

- [ ] **Step 5: Revoke in `destroy()` as a safety net**

At the end of `destroy()`, immediately before `this.mediaSource_ = null;`, add:

```ts
    if (this.objectUrl_) {
      URL.revokeObjectURL(this.objectUrl_);
      this.objectUrl_ = null;
    }
```

- [ ] **Step 6: Type-check and run tests**

Run: `pnpm tsc && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cmaf-lite/lib/media/buffer_controller.ts
git commit -m "fix(buffer_controller): revoke MediaSource object URL on detach"
```

---

## Task 5: In-place `SegmentTracker.reconcile`

**Files:**
- Modify: `packages/cmaf-lite/lib/media/segment_tracker.ts:73-84`
- Modify: `packages/cmaf-lite/test/media/segment_tracker.test.ts`

- [ ] **Step 1: Add a failing identity test**

In `packages/cmaf-lite/test/media/segment_tracker.test.ts`, inside the existing `describe("reconcile", ...)` block, add a second test:

```ts
    it("mutates the tracked list in place rather than allocating a new array", () => {
      const tracker = new SegmentTracker();
      tracker.trackAppend(MediaType.VIDEO, 0, 4, 500);
      tracker.trackAppend(MediaType.VIDEO, 4, 8, 500);

      const internal = (
        tracker as unknown as { segments_: Map<MediaType, unknown[]> }
      ).segments_;
      const listBefore = internal.get(MediaType.VIDEO);

      tracker.reconcile(MediaType.VIDEO, createTimeRanges([4, 8]));

      expect(internal.get(MediaType.VIDEO)).toBe(listBefore);
    });
```

Rationale: the no-alloc contract is behaviorally invisible except through the internal list identity — this test locks it in. The test uses `as unknown as` because `segments_` is a private field.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter cmaf-lite test segment_tracker`
Expected: FAIL on the new identity assertion (`.filter(...)` currently returns a new array and `this.segments_.set(...)` replaces it).

- [ ] **Step 3: Rewrite `reconcile` in place**

In `packages/cmaf-lite/lib/media/segment_tracker.ts`, replace the existing `reconcile` method (including the `TODO(matvp)` comment) with:

```ts
  /**
   * Reconcile tracked segments against SourceBuffer.buffered.
   * Discard entries whose time range is no longer in the buffer.
   * Compacts in place to avoid per-call allocation.
   */
  reconcile(type: MediaType, buffered: TimeRanges) {
    const list = this.segments_.get(type);
    if (!list) {
      return;
    }
    let write = 0;
    for (let read = 0; read < list.length; read++) {
      const segment = list[read];
      if (isTimeBuffered(segment.start, segment.end, buffered)) {
        list[write++] = segment;
      }
    }
    list.length = write;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter cmaf-lite test segment_tracker`
Expected: PASS (both the existing "removes tracked segments..." test and the new identity test).

- [ ] **Step 5: Full type-check and test run**

Run: `pnpm tsc && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cmaf-lite/lib/media/segment_tracker.ts packages/cmaf-lite/test/media/segment_tracker.test.ts
git commit -m "perf(segment_tracker): compact reconcile in place"
```

---

## Task 6: Final verification

- [ ] **Step 1: Format, lint, type-check, test**

Run: `pnpm format && pnpm tsc && pnpm test`
Expected: all clean.

- [ ] **Step 2: Review diff**

Run: `git log --oneline main..HEAD` — should show five feature/refactor/perf/fix commits on top of the spec commit.
