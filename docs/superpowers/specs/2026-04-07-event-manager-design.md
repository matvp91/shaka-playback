# EventManager Design

Centralized event listener manager inspired by shaka-player. Tracks all event subscriptions (both Player EventEmitter and DOM EventTarget) and provides bulk cleanup via `release()`. Eliminates manual `on`/`off` boilerplate in controllers.

## Scope

- Controller-internal only (not exposed on Player public API)
- All four controllers refactored to use EventManager

## Public API

```ts
type ListenOptions = {
  once?: boolean;
};

class EventManager {
  listen<K extends keyof EventMap>(
    target: Player,
    event: K,
    callback: EventMap[K],
    options?: ListenOptions,
  ): void;
  listen(
    target: EventTarget,
    event: string,
    callback: EventListenerOrEventListenerObject,
    options?: ListenOptions,
  ): void;

  release(): void;
}
```

### `listen(target, event, callback, options?)`

Registers a listener on the target and tracks it for bulk removal. Works with both Player (EventEmitter) and DOM EventTarget.

When `options.once` is true, the callback fires once then auto-removes its binding from the internal tracking array.

### `release()`

Removes all tracked listeners from all targets. Clears the internal binding array.

## Internal Design

### Binding storage

```ts
type Binding = {
  remove: () => void;
};
```

Each `listen()` call creates a `Binding` with a `remove` closure that captures the correctly-typed unsubscribe call. No type information stored on the binding itself — types are captured at registration time in the closure.

### `subscribe_` helper

Single point that handles target type detection and routes to the correct API:

```ts
private subscribe_(target, event, callback): Binding {
  if (target instanceof EventTarget) {
    target.addEventListener(event, callback);
    return { remove: () => target.removeEventListener(event, callback) };
  }
  if (target instanceof EventEmitter) {
    target.on(event, callback);
    return { remove: () => target.off(event, callback) };
  }
  throw new Error("Unsupported target");
}
```

### `once` behavior

When `options.once` is true, `listen()` wraps the original callback before passing it to `subscribe_()`. The wrapper:

1. Calls `remove()` on the binding (unsubscribes from the target)
2. Removes the binding from the internal array
3. Invokes the original callback

This ensures cleanup happens whether the event fires (wrapper runs) or never fires (`release()` calls `remove()`). Calling `removeEventListener`/`off` on an already-removed listener is a no-op, so no double-removal issues.

### Type safety approach (Approach 3: Interface-based)

Two overload signatures:

1. **Player overload** — `K extends keyof EventMap`, callback typed as `EventMap[K]`. Full inference on event names and callback parameters.
2. **EventTarget overload** — event is `string`, callback is `EventListenerOrEventListenerObject`. Standard DOM typing.

This avoids per-DOM-target-type overloads (HTMLMediaElement, MediaSource, SourceBuffer). In practice, the DOM events used (`sourceopen`, `updateend`) are generic `Event` — specific DOM event map inference is unnecessary complexity.

## File Location

`lib/utils/event_manager.ts`

## Controller Refactor

Each controller replaces manual `on`/`off` with EventManager:

### Before

```ts
class ManifestController {
  constructor(private player_: Player) {
    this.player_.on(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }
  destroy() {
    this.player_.off(Events.MANIFEST_LOADING, this.onManifestLoading_);
  }
}
```

### After

```ts
class ManifestController {
  private eventManager_ = new EventManager();

  constructor(private player_: Player) {
    this.eventManager_.listen(
      player_,
      Events.MANIFEST_LOADING,
      this.onManifestLoading_,
    );
  }
  destroy() {
    this.eventManager_.release();
  }
}
```

### DOM event migration

```ts
// Before
mediaSource.addEventListener("sourceopen", () => { ... }, { once: true });

// After
this.eventManager_.listen(mediaSource, "sourceopen", () => { ... }, { once: true });
```

### Controllers affected

| Controller | Player events | DOM events |
|---|---|---|
| ManifestController | MANIFEST_LOADING | none |
| MediaController | MEDIA_ATTACHING, BUFFER_EOS | sourceopen (once) |
| BufferController | MEDIA_ATTACHED, TRACKS_SELECTED, SEGMENT_LOADED | updateend (once, per append) |
| StreamController | MANIFEST_PARSED, MEDIA_ATTACHED, BUFFER_CREATED, BUFFER_APPENDED | none |

## No changes to Player

Player keeps its EventEmitter base class and public API. EventManager is internal to controllers only.
