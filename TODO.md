# TODO

Error system — design how network errors surface to consumers (error types, fatality, error events). Replaces the removed errors.ts.

Retry logic — exponential backoff with jitter, per-RequestType configuration, managed by NetworkService.

Caching — segment prefetch cache, lives outside NetworkService in a higher-level component.

MSE teardown — proper cleanup of MSE resources in BufferController on detach. Store object URL for revocation. Add MEDIA_DETACHED handler that: aborts pending operations, removes SourceBuffers from MediaSource (abort() if updating), calls endOfStream(), revokes object URL, clears video.src + load(). Must be reusable (detach/reattach without destroy).

MSE simulation — build lightweight MediaSource and SourceBuffer mocks in `test/__framework__/` (media_source_mock.ts, source_buffer_mock.ts). Enables unit testing buffer_controller, stream_controller, and gap_controller without a real browser. See testing guidelines for the designed API surface.