# Presentation End Time

Add `end` to the `Presentation` manifest model type, resolved during DASH
parsing using the spec-defined fallback chain. Simplifies duration computation
downstream.

## Motivation

The manifest model has `Presentation.start` but no `end`. The architecture
(DESIGN.md) already envisions `start, end (time bounds)` on Presentation, and
`computeDuration_()` in StreamController has a TODO acknowledging this gap. It
currently derives duration by drilling into the last segment's `end` — fragile
and not spec-compliant. Adding `Presentation.end` fills this gap and lays the
foundation for future append window support.

## Design

### Manifest Model

Add `end: number` to `Presentation` in `lib/types/manifest.ts`:

```ts
interface Presentation {
  start: number;
  end: number;
  selectionSets: SelectionSet[];
}
```

`end` is required — every presentation must have a resolved `end` after
parsing. No optional, no sentinel values.

### DASH Type Changes

Add `@_duration?: string` to the `Period` type in `lib/dash/types.ts`. The
`MPD` type already has `@_mediaPresentationDuration`.

### DASH Parser — Resolving `end`

In `lib/dash/dash_parser.ts`, pass `periodIndex` to `parsePeriod()` so it can
look up neighboring periods. Resolve `end` inline using this fallback chain
(per ISO 23009-1, prioritizing `@duration` for future append window support):

1. **`Period@duration`** — `start + parseDuration(period.@duration)`
2. **Next period's `@start`** —
   `parseDuration(mpd.Period[periodIndex + 1].@start)`
3. **`MPD@mediaPresentationDuration`** —
   `parseDuration(mpd.@mediaPresentationDuration)`
4. **Last segment's `end`** — robustness fallback for sparse manifests
   (from any track in the presentation)

Each source short-circuits with an early return. An assertion at the end
ensures `end` is always resolved — if none of the sources produce a value,
parsing fails fast.

`Period@duration` is prioritized over next period's `@start` because it
represents the period's intended content boundary, which is what MSE append
windows will need when implemented later. The next period's `@start` defines
the timeline boundary but may extend beyond the actual content.

### Duration Computation

Simplify `computeDuration_()` in
`lib/controllers/stream_controller.ts` to:

```ts
private computeDuration_(): number {
  const end = this.manifest_?.presentations.at(-1)?.end;
  assertNotVoid(end, "Cannot compute duration");
  return end;
}
```

Removes the TODO comment and all deep drilling into
selectionSets/switchingSets/tracks/segments.

## Files Changed

| File | Change |
|------|--------|
| `lib/types/manifest.ts` | Add `end: number` to `Presentation` |
| `lib/dash/types.ts` | Add `@_duration?: string` to `Period` |
| `lib/dash/dash_parser.ts` | Pass `periodIndex`, resolve `end` with fallback chain + assert |
| `lib/controllers/stream_controller.ts` | Simplify `computeDuration_()` |
