# Testing Guidelines

## Runner

Vitest with `happy-dom` environment. Configured in
`packages/cmaf-lite/vitest.config.ts`.

Scripts in `packages/cmaf-lite/package.json`:

- `test` — `vitest run`

Root `pnpm test` delegates to the package.

## Philosophy

- Test deterministic, logical code only.
- Every test follows **given / when / then** as a mental model:
  set up state, perform an action, assert the outcome.
- No mocking libraries. Use hand-written helpers and
  `vi.useFakeTimers()`.
- Test behavior, not implementation.
- Import types and enums from `lib/` — never duplicate
  definitions in tests. Use `Partial<T>` for factory overrides.

## Test Naming

Test names answer: **"What behavior breaks if this test fails?"**

Describe what is being tested and under what condition.
Add "why" only when the intent isn't obvious from the name.

```typescript
// Good — behavior + condition
it("returns null when position is outside all buffered ranges")
it("merges adjacent ranges when gap is smaller than maxHole")
it("selects the video stream closest to preferred height")
it("throws on unsupported codec strings")

// Bad — describes implementation, not behavior
it("calls compare function")
it("returns the correct value")
it("works correctly")
```

## What to Test

Pure transformations and stateful logic that can be exercised
without real browser APIs:

| Module | Why |
|---|---|
| `dash/dash_parser` | Pure string → Manifest transform |
| `dash/dash_segments` | Pure segment resolution logic |
| `utils/array_utils` | Generic binary search |
| `utils/buffer_utils` | TimeRanges iteration |
| `utils/codec_utils` | Codec string parsing |
| `utils/functional` | Generic array combinators |
| `utils/manifest_utils` | Predicate / key helpers |
| `utils/stream_utils` | Stream selection logic |
| `utils/url_utils` | URL resolution |
| `utils/timer` | Scheduling logic (fake timers) |
| `media/operation_queue` | Queue serialization logic |
| `media/segment_tracker` | Byte tracking and eviction |
| `media/buffer_controller` | MSE lifecycle (with mocks) |
| `media/stream_controller` | Segment fetching orchestration (with mocks) |
| `media/gap_controller` | Stall detection and gap jumping (with mocks) |
| `manifest/manifest_controller` | Manifest loading flow (with mocks) |
| `net/network_service` | Fetch wrapping and events (with mocks) |

## What NOT to Test

- Thin wrappers around external libs (`mp4_box_parser`,
  `xml_utils`).
- Type-only files (`dash_types`, `events`, `config`).
- The `Player` class (wiring only, validated by the demo app).
- `asserts` (trivial throw-on-falsy).

## File Layout

```
packages/cmaf-lite/
  test/
    dash/
      dash_parser.test.ts
      dash_segments.test.ts
    media/
      buffer_controller.test.ts
      stream_controller.test.ts
      gap_controller.test.ts
      operation_queue.test.ts
      segment_tracker.test.ts
    manifest/
      manifest_controller.test.ts
    net/
      network_service.test.ts
    utils/
      array_utils.test.ts
      buffer_utils.test.ts
      codec_utils.test.ts
      functional.test.ts
      manifest_utils.test.ts
      stream_utils.test.ts
      url_utils.test.ts
      timer.test.ts
    fixtures/
      index.ts          # loadFixture(name) helper
      basic.mpd         # MPD fixture files
      ...
    __framework__/
      time_ranges.ts    # createTimeRanges()
      media_source_mock.ts
      source_buffer_mock.ts
      factories.ts      # object factories
  vitest.config.ts
```

## Test Helpers

All helpers live in `test/__framework__/` (except fixtures).

### `time_ranges.ts`

`createTimeRanges(...ranges: [number, number][])` — returns a
`TimeRanges`-compatible object. Used standalone and internally by
`source_buffer_mock`.

### `media_source_mock.ts`

Minimal `MediaSource` simulation:

- State machine: `closed` → `open` → `ended`
- `addSourceBuffer(mimeType)` returns a `SourceBufferMock`
- `readyState`, `duration`
- `sourceopen` event dispatch

No byte parsing, no decoding. Just state transitions and events.

### `source_buffer_mock.ts`

Minimal `SourceBuffer` simulation:

- `appendBuffer()` / `remove()` toggle `updating` and fire
  `updateend`
- `buffered` backed by `createTimeRanges()`
- `timestampOffset`

### `fixtures/index.ts`

`loadFixture(name: string)` — reads a file from the fixtures
directory and returns its content as a string.

### `factories.ts`

Object factories with sensible defaults:

- `createSegmentTemplate(overrides?)`
- `createRepresentation(overrides?)`
- `createAdaptationSet(overrides?)`

Each returns a valid object. Override only what your test cares
about.
