# DASH Parser Simplification — flattenPeriods

## Problem

`flattenPeriods` in `dash_parser.ts` uses nested loops with linear
scans (`find`, `indexOf`) to match and merge switching sets and tracks
across periods. This is fragile (assumes positional track order) and
harder to read than necessary.

## Solution

Replace the parse-then-merge approach with flat accumulation using
two Maps keyed by identity helpers from `manifest_utils`.

## manifest_utils.ts — New Helpers

### `getSwitchingSetId(type: MediaType, codec: string): string`

Returns `${type}:${codec}`. Defines the uniqueness of a switching set.

### `getTrackId(track: Track): string`

Returns a stable identity string based on track type:
- Video: `video:${width}:${height}`
- Audio: `audio`

This removes the assumption that tracks appear in the same order
across periods.

## dash_parser.ts — Changes

### Delete `parseSwitchingSet`

Its two responsibilities split:
- **Codec resolution** — new `resolveCodec(adaptationSet)` function
  in `dash_parser.ts` (DASH-specific XML attribute logic)
- **Track iteration** — absorbed into `flattenPeriods`

### Rewrite `flattenPeriods`

Two Maps, single pass, no merge loop. Add a concise JSDoc comment
explaining the single-loop design is intentional:

```ts
/**
 * Flatten multi-period MPD into switching sets using a
 * single accumulation pass. Tracks are matched by identity
 * (not position) so period order independence is guaranteed.
 */
function flattenPeriods(sourceUrl: string, mpd: MPD): SwitchingSet[] {
  const switchingSetMap = new Map<string, SwitchingSet>();
  const trackMap = new Map<string, Track>();

  for (let i = 0; i < mpd.Period.length; i++) {
    const period = mpd.Period[i];
    const duration = resolvePeriodDuration(mpd, period, i);

    for (const adaptationSet of period.AdaptationSet) {
      const type = inferMediaType(adaptationSet);
      const codec = resolveCodec(adaptationSet);
      const switchingSetId = ManifestUtils.getSwitchingSetId(type, codec);

      for (const representation of adaptationSet.Representation) {
        const track = parseTrack(
          sourceUrl, mpd, period, adaptationSet,
          representation, type, duration,
        );
        const trackId = ManifestUtils.getTrackId(track);
        const compositeKey = `${switchingSetId}:${trackId}`;

        const existingTrack = trackMap.get(compositeKey);
        if (existingTrack) {
          existingTrack.segments.push(...track.segments);
        } else {
          trackMap.set(compositeKey, track);

          let switchingSet = switchingSetMap.get(switchingSetId);
          if (!switchingSet) {
            switchingSet = { type, codec, tracks: [] };
            switchingSetMap.set(switchingSetId, switchingSet);
          }
          switchingSet.tracks.push(track);
        }
      }
    }
  }

  return [...switchingSetMap.values()];
}
```

### Unchanged

- `parseTrack` — stays as-is
- `resolveDuration` — stays as-is
- `resolvePeriodDuration` — stays as-is
- `inferMediaType` — stays as-is

## Files Changed

| File | Change |
|------|--------|
| `lib/utils/manifest_utils.ts` | Add `getSwitchingSetId`, `getTrackId` |
| `lib/dash/dash_parser.ts` | Rewrite `flattenPeriods`, add `resolveCodec`, delete `parseSwitchingSet` |
