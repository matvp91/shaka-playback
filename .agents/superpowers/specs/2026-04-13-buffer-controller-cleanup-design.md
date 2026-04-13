# Buffer Controller Cleanup

Date: 2026-04-13

Small, targeted cleanups in `BufferController` and `SegmentTracker`:

1. Stable, explicitly-removed `sourceopen` listener (no `{ once: true }`).
2. Revoke the `MediaSource` object URL on detach via a new `MEDIA_DETACHING` event.
3. In-place compaction in `SegmentTracker.reconcile` to avoid per-reconcile array allocation.

## 1. `sourceopen` — bound method, explicit removal

`{ once: true }` has poor support on older embedded devices. Replace the inline,
`once`-bound listener with a stable class-field arrow method that removes itself
on first invocation.

In `buffer_controller.ts`:

- Add `private onMediaSourceOpen_ = () => { ... }` class field. Arrow form
  gives a stable bound reference suitable for `removeEventListener`.
- `onMediaAttaching_` attaches the listener without options:
  `this.mediaSource_.addEventListener("sourceopen", this.onMediaSourceOpen_)`.
- First statement of `onMediaSourceOpen_` removes itself:
  `this.mediaSource_?.removeEventListener("sourceopen", this.onMediaSourceOpen_)`.
- Remaining body is what the current inline callback does. Since it no longer
  closes over `event.media`, it reads the media element via
  `this.player_.getMedia()` to emit the `MEDIA_ATTACHED` payload.

## 2. Revoke the object URL on detach

The `URL.createObjectURL(mediaSource)` URL is currently created but never
revoked. Introduce a `MEDIA_DETACHING` event so that controllers can clean up
detach-time resources with access to the media element, symmetric to
`MEDIA_ATTACHING`.

### New event

In `events.ts`:

- Add `MEDIA_DETACHING: "mediaDetaching"` to the `Events` map.
- Add the type:

  ```ts
  export type MediaDetachingEvent = {
    media: HTMLMediaElement;
  };
  ```

- Extend `EventMap` with
  `[Events.MEDIA_DETACHING]: (event: MediaDetachingEvent) => void;`.

### Player

In `player.ts`, `detachMedia()` fires `MEDIA_DETACHING` with the media element
*before* nulling `media_`, preserving `MEDIA_DETACHED` as the post-cleanup
signal:

```ts
detachMedia() {
  if (this.media_) {
    this.emit(Events.MEDIA_DETACHING, { media: this.media_ });
  }
  this.media_ = null;
  this.emit(Events.MEDIA_DETACHED);
}
```

### BufferController

- Add `private objectUrl_: string | null = null`.
- In `onMediaAttaching_`:

  ```ts
  this.objectUrl_ = URL.createObjectURL(this.mediaSource_);
  event.media.src = this.objectUrl_;
  ```

- Subscribe to `MEDIA_DETACHING` in the constructor (and unsubscribe in
  `destroy`). Handler revokes and clears:

  ```ts
  private onMediaDetaching_ = () => {
    if (this.objectUrl_) {
      URL.revokeObjectURL(this.objectUrl_);
      this.objectUrl_ = null;
    }
  };
  ```

- `destroy()` also revokes if still set, as a safety net.

Other controllers continue to listen on `MEDIA_DETACHED` unchanged.

## 3. In-place reconcile in `SegmentTracker`

Replace the allocating `list.filter(...)` + `Map.set` with two-pointer
compaction:

```ts
reconcile(type: MediaType, buffered: TimeRanges) {
  const list = this.segments_.get(type);
  if (!list) {
    return;
  }
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const seg = list[read];
    if (isTimeBuffered(seg.start, seg.end, buffered)) {
      list[write++] = seg;
    }
  }
  list.length = write;
}
```

No new array, no map write. The `TODO(matvp)` is removed.

## Testing

- Existing `buffer_controller` and `segment_tracker` tests must continue to
  pass.
- New `segment_tracker` test: after `reconcile`, the list reference in the
  internal map is the same array instance it was before (identity check),
  locking in the no-alloc contract.
- New `buffer_controller` test: after attach + detach, `URL.revokeObjectURL`
  has been called with the URL produced by `URL.createObjectURL`.

## Out of scope

- No changes to `StreamController`, `GapController`, `OperationQueue`, or any
  other consumer. They listen to `MEDIA_DETACHED`, which still fires.
- No broader refactor of `BufferController`. This is targeted cleanup, not
  redesign.
