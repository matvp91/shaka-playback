# DASH Parser Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify `flattenPeriods` in `dash_parser.ts` by replacing linear scans with Map-based accumulation, using identity helpers from `manifest_utils`.

**Architecture:** Two new identity functions in `manifest_utils` (`getSwitchingSetId`, `getTrackId`) define switching set and track uniqueness. `flattenPeriods` uses two Maps keyed by these IDs for O(1) lookups. The old `parseSwitchingSet` function is deleted — codec resolution becomes its own function, track iteration moves into `flattenPeriods`.

**Tech Stack:** TypeScript, Biome

---

### Task 1: Add identity helpers to manifest_utils

**Files:**
- Modify: `packages/cmaf-lite/lib/utils/manifest_utils.ts`

- [ ] **Step 1: Add `getSwitchingSetId`**

Add the import and function after the existing `isInitSegment`:

```ts
import type { MediaType } from "../types/media";
```

```ts
/**
 * Unique identity of a switching set: type + codec.
 */
export function getSwitchingSetId(
  type: MediaType,
  codec: string,
): string {
  return `${type}:${codec}`;
}
```

- [ ] **Step 2: Add `getTrackId`**

Add below `getSwitchingSetId`:

```ts
/**
 * Unique identity of a track within a switching set.
 * Video tracks are keyed by resolution, audio tracks
 * by type alone.
 */
export function getTrackId(track: Track): string {
  if (track.type === MediaType.VIDEO) {
    return `video:${track.width}:${track.height}`;
  }
  return "audio";
}
```

The `Track` import is already available from the existing `"../types/manifest"` import — add it to that import statement.

The `MediaType` import needs the value (not just the type) since we compare against `MediaType.VIDEO`. Use a value import:

```ts
import { MediaType } from "../types/media";
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm tsc`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/utils/manifest_utils.ts
git commit -m "feat(dash): add switching set and track identity helpers"
```

---

### Task 2: Add `resolveCodec` to dash_parser

**Files:**
- Modify: `packages/cmaf-lite/lib/dash/dash_parser.ts`

- [ ] **Step 1: Add `resolveCodec` function**

Add after `inferMediaType` at the bottom of the file:

```ts
function resolveCodec(adaptationSet: AdaptationSet): string {
  const firstRep = adaptationSet.Representation[0];
  asserts.assertExists(firstRep, "No Representation found");

  const codec = Functional.findMap([firstRep, adaptationSet], (node) =>
    node["@_codecs"]?.toLowerCase(),
  );
  asserts.assertExists(codec, "codecs is mandatory");

  return codec;
}
```

This is the codec logic extracted from `parseSwitchingSet` (lines 136-142).

- [ ] **Step 2: Verify types compile**

Run: `pnpm tsc`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/cmaf-lite/lib/dash/dash_parser.ts
git commit -m "refactor(dash): extract resolveCodec from parseSwitchingSet"
```

---

### Task 3: Rewrite `flattenPeriods` and delete `parseSwitchingSet`

**Files:**
- Modify: `packages/cmaf-lite/lib/dash/dash_parser.ts`

- [ ] **Step 1: Add ManifestUtils import**

Add to the imports at the top of the file:

```ts
import * as ManifestUtils from "../utils/manifest_utils";
```

- [ ] **Step 2: Replace `flattenPeriods`**

Replace the entire `flattenPeriods` function (lines 49-81) with:

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
          sourceUrl,
          mpd,
          period,
          adaptationSet,
          representation,
          type,
          duration,
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

- [ ] **Step 3: Delete `parseSwitchingSet`**

Delete the entire `parseSwitchingSet` function (lines 128-149 in the original file). All its logic is now covered by `resolveCodec` and the new `flattenPeriods`.

- [ ] **Step 4: Verify types compile**

Run: `pnpm tsc`
Expected: no errors

- [ ] **Step 5: Format**

Run: `pnpm format`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/cmaf-lite/lib/dash/dash_parser.ts
git commit -m "refactor(dash): rewrite flattenPeriods as single-pass Map accumulation"
```
