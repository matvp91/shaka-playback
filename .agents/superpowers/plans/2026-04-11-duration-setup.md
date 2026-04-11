# Duration Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move duration management from `BUFFER_CODECS` to `MANIFEST_PARSED`, extract `blockUntil` as a reusable queue serializer, and add dual-trigger duration setting.

**Architecture:** `BufferController` stores a manifest reference from `MANIFEST_PARSED` and calls `updateDuration_()` from two places (manifest parsed + sourceopen) to cover both timing orderings. A new `blockUntil(callback)` method serializes MediaSource mutations against source buffer queues, replacing inlined blocking in `updateDuration_` and `onBufferEos_`.

**Tech Stack:** TypeScript, MSE (MediaSource Extensions)

---

### Task 1: Remove `duration` from `BufferCodecsEvent`

**Files:**
- Modify: `packages/cmaf-lite/lib/events.ts:76-80`
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts:134-138`
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts:207-211`
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts:111`

- [ ] **Step 1: Remove `duration` from `BufferCodecsEvent`**

In `packages/cmaf-lite/lib/events.ts`, change:

```ts
export type BufferCodecsEvent = {
  type: MediaType;
  codec: string;
  duration: number;
};
```

To:

```ts
export type BufferCodecsEvent = {
  type: MediaType;
  codec: string;
};
```

- [ ] **Step 2: Remove `duration` from stream controller emissions**

In `packages/cmaf-lite/lib/media/stream_controller.ts`, change line 134-138:

```ts
this.player_.emit(Events.BUFFER_CODECS, {
  type: mediaState.type,
  codec: switchingSet.codec,
  duration: this.manifest_.duration,
});
```

To:

```ts
this.player_.emit(Events.BUFFER_CODECS, {
  type: mediaState.type,
  codec: switchingSet.codec,
});
```

And change line 207-211:

```ts
this.player_.emit(Events.BUFFER_CODECS, {
  type,
  codec: switchingSet.codec,
  duration: this.manifest_.duration,
});
```

To:

```ts
this.player_.emit(Events.BUFFER_CODECS, {
  type,
  codec: switchingSet.codec,
});
```

- [ ] **Step 3: Remove `updateDuration_` call from `onBufferCodecs_`**

In `packages/cmaf-lite/lib/media/buffer_controller.ts`, remove line 111:

```ts
this.updateDuration_(event.duration);
```

- [ ] **Step 4: Run type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cmaf-lite/lib/events.ts packages/cmaf-lite/lib/media/stream_controller.ts packages/cmaf-lite/lib/media/buffer_controller.ts
git commit -m "refactor: remove duration from BUFFER_CODECS event"
```

---

### Task 2: Add `blockUntil`, refactor `updateDuration_` and `onBufferEos_`

**Files:**
- Modify: `packages/cmaf-lite/lib/media/buffer_controller.ts`

- [ ] **Step 1: Add `ManifestParsedEvent` to imports**

In `packages/cmaf-lite/lib/media/buffer_controller.ts`, add `ManifestParsedEvent` to the event imports:

```ts
import type {
  BufferAppendedEvent,
  BufferAppendingEvent,
  BufferCodecsEvent,
  ManifestParsedEvent,
  MediaAttachingEvent,
} from "../events";
```

- [ ] **Step 2: Add manifest field**

Add field to the class alongside the other private fields:

```ts
private manifest_: Manifest | null = null;
```

The `Manifest` type is already available from the existing `import type { InitSegment, Segment } from "../types/manifest"` — add `Manifest` to that import:

```ts
import type { InitSegment, Manifest, Segment } from "../types/manifest";
```

- [ ] **Step 3: Add `MANIFEST_PARSED` listener in constructor and destroy**

In the constructor, add:

```ts
this.player_.on(Events.MANIFEST_PARSED, this.onManifestParsed_);
```

In `destroy()`, add the off call alongside the other listener removals:

```ts
this.player_.off(Events.MANIFEST_PARSED, this.onManifestParsed_);
```

And add to destroy's cleanup section:

```ts
this.manifest_ = null;
```

- [ ] **Step 4: Add `onManifestParsed_` handler**

Add the handler after `onMediaAttaching_`:

```ts
private onManifestParsed_ = (event: ManifestParsedEvent) => {
  this.manifest_ = event.manifest;
  this.updateDuration_();
};
```

- [ ] **Step 5: Add `blockUntil` method**

Add the method before `updateDuration_`:

```ts
/**
 * Block all source buffer operation queues, then run
 * callback once they drain. If no source buffers exist,
 * the callback runs immediately.
 */
private blockUntil(callback: () => void) {
  const types = [...this.sourceBuffers_.keys()];
  const blockers = types.map((type) => this.opQueue_.block(type));
  Promise.all(blockers).then(callback);
}
```

- [ ] **Step 6: Refactor `updateDuration_`**

Replace the existing `updateDuration_` method with:

```ts
/**
 * Set mediaSource.duration from the manifest. Uses
 * blockUntil to avoid InvalidStateError when a
 * SourceBuffer is updating.
 */
private updateDuration_() {
  if (!this.manifest_ || this.mediaSource_?.readyState !== "open") {
    return;
  }
  const duration = this.manifest_.duration;
  if (this.mediaSource_.duration === duration) {
    return;
  }
  this.blockUntil(() => {
    if (this.mediaSource_?.readyState === "open") {
      this.mediaSource_.duration = duration;
    }
  });
}
```

- [ ] **Step 7: Refactor `onBufferEos_`**

Replace the existing `onBufferEos_` method with:

```ts
private onBufferEos_ = () => {
  this.blockUntil(() => {
    if (this.mediaSource_?.readyState === "open") {
      this.mediaSource_.endOfStream();
    }
  });
};
```

- [ ] **Step 8: Add `updateDuration_()` call to `sourceopen` callback**

In `onMediaAttaching_`, add `this.updateDuration_()` after the `MEDIA_ATTACHED` emit inside the sourceopen callback:

```ts
this.mediaSource_.addEventListener(
  "sourceopen",
  () => {
    asserts.assertExists(this.mediaSource_, "No MediaSource");
    this.player_.emit(Events.MEDIA_ATTACHED, {
      media: event.media,
      mediaSource: this.mediaSource_,
    });
    this.updateDuration_();
  },
  { once: true },
);
```

- [ ] **Step 9: Run type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/cmaf-lite/lib/media/buffer_controller.ts
git commit -m "refactor: move duration to MANIFEST_PARSED, extract blockUntil"
```

---

### Task 3: Final verification

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: Run format check**

Run: `pnpm format`
Expected: PASS

- [ ] **Step 4: Commit any formatting fixes**

If formatting produced changes:

```bash
git add -A
git commit -m "chore: format"
```
