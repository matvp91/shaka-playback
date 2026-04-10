# Duration-Based SegmentTemplate Support

## Problem

The DASH parser hard-requires `SegmentTimeline` inside `SegmentTemplate`. Manifests
that use duration-based addressing (simple addressing mode) — where `@duration` and
`@timescale` define uniform segment lengths with no `SegmentTimeline` — fail at parse
time with "SegmentTimeline is mandatory".

This blocks playback of common DASH content such as the BBB multi-codec dataset at
`https://ftp.itec.aau.at/datasets/mmsys18/BBB/BBB_2sec/multi-codec.mpd`.

## Background: DASH Addressing Modes

The DASH spec defines two mutually exclusive segment addressing modes:

- **Explicit addressing**: `SegmentTimeline` is present. Segments are enumerated via
  `S` entries with `@d`, `@t`, `@r`. Supports variable-duration segments. Both
  `$Number$` and `$Time$` template variables work.
- **Simple addressing**: No `SegmentTimeline`. `@duration` and `@timescale` define a
  uniform segment length. Segment count is derived from the presentation duration.
  `$Number$` is the standard template variable; `$Time$` is theoretically valid but
  never seen in practice.

Both modes feed `number` and `time` into `processUriTemplate`. The template string
determines which placeholder is substituted. Our code does not need to distinguish
numbered vs timed templates.

## Design

### Parse Order Restructuring (`dash_parser.ts`)

Current flow in `parsePeriod`:

1. Parse switching sets (parses segments via `parseSegmentData`)
2. `resolvePresentationEnd` (may fall back to last segment end)

This creates a circular dependency for duration-based addressing: segment generation
needs the presentation duration, but the duration fallback needs parsed segments.

New flow:

1. `resolvePresentationDuration` — metadata-only, returns `number | null`
2. Parse switching sets — passes duration into `parseSegmentData`
3. `resolvePresentationEnd` — uses duration if available, otherwise falls back to
   last segment end (only valid for explicit addressing)

#### `resolvePresentationDuration`

Resolves the period's duration from manifest metadata only, without requiring parsed
segments. This must run before segment parsing so that duration-based segment
generation has the information it needs.

Fallback chain (returns a relative duration, not an absolute end time):
1. Period `@duration` (already relative)
2. Next Period `@start` minus current period start
3. MPD `@mediaPresentationDuration` minus current period start (the MPD value is an
   absolute end; subtracting period start yields this period's duration)

Returns `number | null`. A null result means metadata alone cannot determine the
duration — callers must get it from parsed segment data instead.

#### `resolvePresentationEnd`

Resolves the absolute end time for the Presentation after segments have been parsed.
Unlike `resolvePresentationDuration`, this function can use segment data as a last
resort when metadata is incomplete.

Resolution:
- If `resolvePresentationDuration` returned a value: `periodStart + duration`
- Otherwise: last segment's end time (assert it exists)

### Branching in `parseSegmentData` (`dash_presentation.ts`)

`parseSegmentData` gains a `duration` parameter (`number | null`).

After resolving the merged `SegmentTemplate` and asserting common required fields
(`@initialization`, `@media`, `@timescale`), it branches:

- **`SegmentTimeline` present** → call `mapTemplateTimeline` (existing, unchanged)
- **`SegmentTimeline` absent** → assert `duration` is not null and `@duration` exists,
  then call `mapTemplateDuration`

### New Function: `mapTemplateDuration`

Generates `Segment[]` from uniform duration info:

- Segment duration in seconds: `@duration / @timescale`
- Segment count: `ceil(presentationDuration / segmentDurationSeconds)`
- Loop from `@startNumber` (default 1), for each segment compute:
  - `number`: incrementing counter
  - `time`: `(i) * @duration` (in timescale units, for `$Time$` substitution)
  - `start`: `(time - pto) / timescale + periodStart`
  - `end`: `(time - pto + @duration) / timescale + periodStart`
  - URL via `processUriTemplate(media, id, number, null, bandwidth, time)`

### Error Cases

- No `SegmentTimeline` and no resolvable duration → error: "duration-based addressing
  requires a resolvable presentation duration"
- No `SegmentTimeline` and no `@duration` on the template → error: "SegmentTemplate
  requires either SegmentTimeline or @duration"
- Has `SegmentTimeline` → existing behavior, no duration needed

## Files Changed

- `packages/cmaf-lite/lib/dash/dash_parser.ts` — parse order restructuring, new
  `resolvePresentationDuration`, simplified `resolvePresentationEnd`
- `packages/cmaf-lite/lib/dash/dash_presentation.ts` — duration parameter on
  `parseSegmentData`, branch on `SegmentTimeline`, new `mapTemplateDuration`

## Files Unchanged

- `packages/cmaf-lite/lib/dash/dash_types.ts` — already has optional `@duration` and
  optional `SegmentTimeline`
- `packages/cmaf-lite/lib/types/manifest.ts` — output model is identical for both
  addressing modes
