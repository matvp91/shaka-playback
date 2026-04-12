# Duration Setup Refactor

## Problem

Duration is currently passed through `BUFFER_CODECS`, which is the wrong
event for this concern. The stream controller stuffs `manifest_.duration`
into `BUFFER_CODECS` so the buffer controller can set
`mediaSource.duration`. Duration is a manifest-level property and should
be driven by `MANIFEST_PARSED`.

Additionally, `updateDuration_` and `onBufferEos_` both inline the same
queue-blocking pattern. This should be extracted into a reusable method.

## Design

### `blockUntil(callback)`

A reusable method that blocks all source buffer operation queues, then
runs a callback once they drain. If no source buffers exist, the callback
runs immediately (empty `Promise.all` resolves synchronously).

```ts
private blockUntil(callback: () => void) {
  const types = [...this.sourceBuffers_.keys()];
  const blockers = types.map((type) => this.opQueue_.block(type));
  Promise.all(blockers).then(callback);
}
```

Used by `updateDuration_` and `onBufferEos_`.

### Manifest storage

`BufferController` stores a manifest reference and listens to
`MANIFEST_PARSED`:

```ts
private manifest_: Manifest | null = null;

private onManifestParsed_ = (event: ManifestParsedEvent) => {
  this.manifest_ = event.manifest;
  this.updateDuration_();
};
```

Listener registered in constructor, unregistered and nulled in
`destroy()`.

### `updateDuration_()` refactor

Takes no parameters. Reads duration from `manifest_.duration`. Guards on
manifest existence and `readyState === "open"` at call time. Uses
`blockUntil` to safely set `mediaSource.duration`:

```ts
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

### `onBufferEos_` refactor

Simplified to use `blockUntil`:

```ts
private onBufferEos_ = () => {
  this.blockUntil(() => {
    if (this.mediaSource_?.readyState === "open") {
      this.mediaSource_.endOfStream();
    }
  });
};
```

### Dual-trigger for duration

`updateDuration_()` is called from two places to cover both timing
scenarios:

1. **`onManifestParsed_`** — manifest arrives. If MediaSource is already
   open, duration is set immediately. If not, this is a no-op.
2. **`sourceopen` callback** in `onMediaAttaching_` — MediaSource opens.
   If manifest has already arrived, duration is set. If not, this is a
   no-op.

This covers both orderings without deferred promises or special timing
logic. The `readyState` and duration equality guards make redundant calls
harmless.

### `BUFFER_CODECS` cleanup

- Remove `duration` field from `BufferCodecsEvent` in `events.ts`
- Remove `duration: this.manifest_.duration` from both emit sites in
  `stream_controller.ts`
- Remove `this.updateDuration_(event.duration)` from `onBufferCodecs_`
  in `buffer_controller.ts`

## Files Changed

- `packages/cmaf-lite/lib/media/buffer_controller.ts` — main refactor
- `packages/cmaf-lite/lib/events.ts` — remove `duration` from
  `BufferCodecsEvent`
- `packages/cmaf-lite/lib/media/stream_controller.ts` — remove
  `duration` from `BUFFER_CODECS` emissions
