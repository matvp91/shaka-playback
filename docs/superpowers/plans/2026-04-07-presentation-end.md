# Presentation End Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `end` to the `Presentation` manifest model, resolved during DASH parsing via a spec-defined fallback chain, simplifying duration computation downstream.

**Architecture:** Resolve `Presentation.end` inline in `parsePeriod()` using four fallback sources (Period@duration, next Period@start, MPD@mediaPresentationDuration, last segment end). Simplify `computeDuration_()` to read from the last presentation's `end`.

**Tech Stack:** TypeScript

---

### Task 1: Add `end` to `Presentation` type

**Files:**
- Modify: `lib/types/manifest.ts:15-18`

- [ ] **Step 1: Add `end` property**

```ts
export type Presentation = {
  start: number;
  end: number;
  selectionSets: SelectionSet[];
};
```

- [ ] **Step 2: Run type check to see what breaks**

Run: `pnpm tsc`
Expected: Type errors in `dash_parser.ts` (missing `end` in return value)

- [ ] **Step 3: Commit**

```bash
git add lib/types/manifest.ts
git commit -m "feat: add end property to Presentation type"
```

---

### Task 2: Add `@_duration` to DASH `Period` type

**Files:**
- Modify: `lib/dash/types.ts:7-12`

- [ ] **Step 1: Add `@_duration` to Period**

```ts
export type Period = {
  "@_start"?: string;
  "@_duration"?: string;
  BaseURL?: TextNode;
  SegmentTemplate?: SegmentTemplate;
  AdaptationSet: AdaptationSet[];
};
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: Still errors from Task 1 (missing `end`), but no new errors from this change

- [ ] **Step 3: Commit**

```bash
git add lib/dash/types.ts
git commit -m "feat: add @duration to DASH Period type"
```

---

### Task 3: Resolve `end` in DASH parser

**Files:**
- Modify: `lib/dash/dash_parser.ts:57-58` (map call)
- Modify: `lib/dash/dash_parser.ts:66-81` (parsePeriod signature and body)

- [ ] **Step 1: Pass `periodIndex` in the map call**

In `parseManifest`, change the `map` call at line 57:

```ts
  const presentations = mpd.Period.map((period, periodIndex) =>
    parsePeriod(options, mpd, period, periodIndex),
  );
```

- [ ] **Step 2: Resolve `end` in `parsePeriod`**

Replace the `parsePeriod` function:

```ts
function parsePeriod(
  options: ParseManifestOptions,
  mpd: MPD,
  period: Period,
  periodIndex: number,
): Presentation {
  const start = period["@_start"] ? parseDuration(period["@_start"]) : 0;

  const grouped = groupAdaptationSets(period.AdaptationSet);

  const selectionSets: SelectionSet[] = Array.from(grouped.entries()).map(
    ([_key, adaptationSets]) =>
      parseSelectionSet(options, mpd, period, adaptationSets),
  );

  const end = resolvePresentationEnd(mpd, period, periodIndex, start, selectionSets);

  return { start, end, selectionSets };
}
```

- [ ] **Step 3: Add `resolvePresentationEnd` function**

Add after `parsePeriod`:

```ts
/**
 * Resolve presentation end time using the
 * DASH spec fallback chain:
 * 1. Period@duration
 * 2. Next Period@start
 * 3. MPD@mediaPresentationDuration
 * 4. Last segment end (robustness fallback)
 */
function resolvePresentationEnd(
  mpd: MPD,
  period: Period,
  periodIndex: number,
  start: number,
  selectionSets: SelectionSet[],
): number {
  const duration = period["@_duration"];
  if (duration != null) {
    return start + parseDuration(duration);
  }

  const nextStart = mpd.Period[periodIndex + 1]?.["@_start"];
  if (nextStart != null) {
    return parseDuration(nextStart);
  }

  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return parseDuration(mpdDuration);
  }

  const lastSegmentEnd =
    selectionSets[0]?.switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  assertNotVoid(lastSegmentEnd, "Cannot resolve presentation end");
  return lastSegmentEnd;
}
```

- [ ] **Step 4: Run type check**

Run: `pnpm tsc`
Expected: PASS — all type errors resolved

- [ ] **Step 5: Run format**

Run: `pnpm format`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/dash/dash_parser.ts
git commit -m "feat: resolve Presentation.end during DASH parsing"
```

---

### Task 4: Simplify `computeDuration_()`

**Files:**
- Modify: `lib/controllers/stream_controller.ts:286-298`

- [ ] **Step 1: Simplify the method**

Replace the `computeDuration_` method and its JSDoc:

```ts
  /** Get total presentation duration. */
  private computeDuration_(): number {
    const end = this.manifest_?.presentations.at(-1)?.end;
    assertNotVoid(end, "Cannot compute duration");
    return end;
  }
```

- [ ] **Step 2: Run type check**

Run: `pnpm tsc`
Expected: PASS

- [ ] **Step 3: Run dev server and verify playback**

Run: `pnpm dev`
Expected: Player loads, plays, and the video duration is correct in the controls

- [ ] **Step 4: Run format**

Run: `pnpm format`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/controllers/stream_controller.ts
git commit -m "refactor: simplify computeDuration using Presentation.end"
```
