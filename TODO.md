# TODO

Request & error handling — cancellable Request<T> class, type-safe PlayerError with ErrorCode discriminated union, ERROR event. Wire through ManifestController and StreamController. Seek aborts in-flight fetches. See docs/superpowers/specs/2026-04-07-request-and-error-handling-design.md and docs/superpowers/plans/2026-04-07-request-and-error-handling.md.

Merge media_controller and buffer_controller

Create a struct to keep sourceBuffer listeners instead of storing it in listeners_ in buffer_controller.

Preference API for track selection — expose a preference-based API (e.g., prefer 1080p, prefer ABR) rather than exposing tracks directly. Immediate switch on preference change. Stream controller resets to IDLE with new track. Design the public API on Player.

Seek to end restarts playback — when seeking to the end, the player immediately restarts instead of staying at the end. Seeking is broken after this occurs.

AbortController for in-flight segment fetches — replace State.LOADING with AbortController on MediaState. On seek: abort fetch, null lastSegment, start fresh from new position. Listen for `seeking` event to trigger abort + state reset. Without this, seeking during a load leaves lastSegment stale. Both shaka v2 (operation.abort()) and hls.js (fragPrevious + sequence tracking) handle this.