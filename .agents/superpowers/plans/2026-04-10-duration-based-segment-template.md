# Duration-Based SegmentTemplate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support DASH manifests that use duration-based segment addressing (simple addressing mode) without a SegmentTimeline.

**Architecture:** Split presentation duration resolution into a metadata-only phase (before segment parsing) and a final phase (after). Branch segment generation in `parseSegmentData` based on `SegmentTimeline` presence, adding a new `mapTemplateDuration` function for the simple addressing path.

**Tech Stack:** TypeScript, `@svta/cml-dash` (URI template processing), `@svta/cml-iso-8601` (duration parsing)

**Spec:** `.agents/superpowers/2026-04-10-duration-based-segment-template-design.md`

---

### Task 1: Create feature branch

**Files:** None

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feat/duration-based-segment-template
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: On branch `feat/duration-based-segment-template`, nothing to commit.

---

### Task 2: Extract `resolvePresentationDuration` in `dash_parser.ts`

**Files:**
- Modify: `packages/cmaf-lite/lib/dash/dash_parser.ts`

- [ ] **Step 1: Add `resolvePresentationDuration` function**

Add this function after the existing `resolvePresentationEnd`:

```typescript
/**
 * Resolve the period's duration from manifest metadata only.
 * Runs before segment parsing so duration-based segment
 * generation has the information it needs. Returns null when
 * metadata alone cannot determine the duration — callers must
 * fall back to parsed segment data instead.
 */
function resolvePresentationDuration(
  mpd: MPD,
  period: Period,
  periodIndex: number,
  start: number,
): number | null {
  const duration = period["@_duration"];
  if (duration != null) {
    return decodeIso8601Duration(duration);
  }

  const nextStart = mpd.Period[periodIndex + 1]?.["@_start"];
  if (nextStart != null) {
    return decodeIso8601Duration(nextStart) - start;
  }

  const mpdDuration = mpd["@_mediaPresentationDuration"];
  if (mpdDuration != null) {
    return decodeIso8601Duration(mpdDuration) - start;
  }

  return null;
}
```

- [ ] **Step 2: Update `parsePeriod` to call `resolvePresentationDuration` before parsing switching sets**

Change `parsePeriod` to:

```typescript
function parsePeriod(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  periodIndex: number,
): Presentation {
  const start = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const duration = resolvePresentationDuration(
    mpd,
    period,
    periodIndex,
    start,
  );

  const switchingSets = period.AdaptationSet.map((as) => {
    const type = inferMediaType(as);
    asserts.assertExists(type, "Cannot infer media type");
    return parseSwitchingSet(sourceUrl, mpd, period, as, type, duration);
  });

  const end = resolvePresentationEnd(duration, start, switchingSets);

  return { start, end, switchingSets };
}
```

- [ ] **Step 3: Simplify `resolvePresentationEnd`**

Replace the existing function with:

```typescript
/**
 * Resolve the absolute end time for the Presentation. Unlike
 * resolvePresentationDuration, this runs after segment parsing
 * and can use segment data as a last resort when metadata is
 * incomplete (only valid for explicit addressing).
 */
function resolvePresentationEnd(
  duration: number | null,
  start: number,
  switchingSets: SwitchingSet[],
): number {
  if (duration != null) {
    return start + duration;
  }

  const lastSegmentEnd = switchingSets[0]?.tracks[0]?.segments.at(-1)?.end;
  asserts.assertExists(lastSegmentEnd, "Cannot resolve presentation end");
  return lastSegmentEnd;
}
```

- [ ] **Step 4: Thread `duration` through `parseSwitchingSet` and `parseTrack`**

Update `parseSwitchingSet` to accept and pass through `duration`:

```typescript
function parseSwitchingSet(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  type: MediaType,
  duration: number | null,
): SwitchingSet {
  const firstRep = adaptationSet.Representation[0];
  asserts.assertExists(firstRep, "No Representation found");

  const codec = Functional.findMap([firstRep, adaptationSet], (node) =>
    node["@_codecs"]?.toLowerCase(),
  );
  asserts.assertExists(codec, "codecs is mandatory");

  const tracks = adaptationSet.Representation.map((rep) =>
    parseTrack(sourceUrl, mpd, period, adaptationSet, rep, type, duration),
  );

  return { type, codec, tracks };
}
```

Update `parseTrack` to accept and pass through `duration`:

```typescript
function parseTrack(
  sourceUrl: string,
  mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  type: MediaType,
  duration: number | null,
): Track {
  const baseUrls = Functional.filterMap(
    [mpd, period, adaptationSet, representation],
    (node) => node.BaseURL?.["#text"],
  );
  const baseUrl = UrlUtils.resolveUrls([sourceUrl, ...baseUrls]);

  const bandwidth = XmlUtils.asNumber(representation["@_bandwidth"]);
  asserts.assertExists(bandwidth, "bandwidth is mandatory");

  const segmentData = parseSegmentData(
    mpd,
    period,
    adaptationSet,
    representation,
    baseUrl,
    duration,
  );

  // ... rest unchanged
```

- [ ] **Step 5: Run type check**

```bash
pnpm tsc
```

Expected: Fails — `parseSegmentData` is called with 6 args but still accepts 5. This is expected; proceed to Task 3.

---

### Task 3: Add duration parameter and branching in `dash_presentation.ts`

**Files:**
- Modify: `packages/cmaf-lite/lib/dash/dash_presentation.ts`

- [ ] **Step 1: Update `parseSegmentData` signature and add branching**

Replace the current `parseSegmentData` function with:

```typescript
export function parseSegmentData(
  _mpd: MPD,
  period: Period,
  adaptationSet: AdaptationSet,
  representation: Representation,
  baseUrl: string,
  duration: number | null,
) {
  const st = resolveSegmentTemplate(
    period.SegmentTemplate,
    adaptationSet.SegmentTemplate,
    representation.SegmentTemplate,
  );

  const initialization = st["@_initialization"];
  asserts.assertExists(initialization, "initialization is mandatory");

  const media = st["@_media"];
  asserts.assertExists(media, "media is mandatory");

  const timescale = XmlUtils.asNumber(st["@_timescale"]);
  asserts.assertExists(timescale, "timescale is mandatory");

  const bandwidth = XmlUtils.asNumber(representation["@_bandwidth"]);
  asserts.assertExists(bandwidth, "bandwidth is mandatory");

  const pto = XmlUtils.asNumber(st["@_presentationTimeOffset"]) ?? 0;

  const periodStart = period["@_start"]
    ? decodeIso8601Duration(period["@_start"])
    : 0;

  const initSegmentUrl = UrlUtils.resolveUrl(
    processUriTemplate(
      initialization,
      representation["@_id"],
      null,
      null,
      bandwidth,
      null,
    ),
    baseUrl,
  );

  const segments = st.SegmentTimeline
    ? mapTemplateTimeline(
        st.SegmentTimeline,
        media,
        st,
        representation,
        baseUrl,
        bandwidth,
        pto,
        periodStart,
      )
    : mapTemplateDuration(
        st,
        media,
        representation,
        baseUrl,
        bandwidth,
        pto,
        periodStart,
        duration,
      );

  const initSegment: InitSegment = {
    url: initSegmentUrl,
  };

  return { initSegment, segments };
}
```

- [ ] **Step 2: Run type check**

```bash
pnpm tsc
```

Expected: Error about `mapTemplateDuration` not existing yet. Proceed to Task 4.

---

### Task 4: Implement `mapTemplateDuration`

**Files:**
- Modify: `packages/cmaf-lite/lib/dash/dash_presentation.ts`

- [ ] **Step 1: Add `mapTemplateDuration` function**

Add after `mapTemplateTimeline`:

```typescript
function mapTemplateDuration(
  st: SegmentTemplate,
  media: string,
  representation: Representation,
  baseUrl: string,
  bandwidth: number,
  pto: number,
  periodStart: number,
  presentationDuration: number | null,
): Segment[] {
  asserts.assertExists(
    presentationDuration,
    "Duration-based addressing requires a resolvable presentation duration",
  );

  const templateDuration = XmlUtils.asNumber(st["@_duration"]);
  asserts.assertExists(
    templateDuration,
    "SegmentTemplate requires either SegmentTimeline or @duration",
  );

  const timescale = XmlUtils.asNumber(st["@_timescale"]) ?? 1;
  const startNumber = XmlUtils.asNumber(st["@_startNumber"]) ?? 1;
  const segmentDuration = templateDuration / timescale;
  const segmentCount = Math.ceil(presentationDuration / segmentDuration);

  const segments: Segment[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const number = startNumber + i;
    const time = i * templateDuration;
    const relativeUrl = processUriTemplate(
      media,
      representation["@_id"],
      number,
      null,
      bandwidth,
      time,
    );
    const url = UrlUtils.resolveUrl(relativeUrl, baseUrl);
    segments.push({
      url,
      start: (time - pto) / timescale + periodStart,
      end: (time - pto + templateDuration) / timescale + periodStart,
    });
  }

  return segments;
}
```

- [ ] **Step 2: Remove unused `SegmentTimeline` import if needed**

The `SegmentTimeline` type import is still used by `mapTemplateTimeline`, so no change needed. But verify that the `SegmentTimeline` import in the type import block is still referenced.

- [ ] **Step 3: Run type check**

```bash
pnpm tsc
```

Expected: No errors.

- [ ] **Step 4: Run format**

```bash
pnpm format
```

Expected: No formatting issues (or auto-fixed).

- [ ] **Step 5: Commit both files together**

This commit includes the `dash_parser.ts` restructuring from Task 2 and the
`dash_presentation.ts` changes from Tasks 3–4.

```bash
git add packages/cmaf-lite/lib/dash/dash_parser.ts packages/cmaf-lite/lib/dash/dash_presentation.ts
git commit -m "feat: support duration-based SegmentTemplate addressing"
```

---

### Task 5: Verify with demo app

**Files:** None (demo already points at the BBB manifest)

- [ ] **Step 1: Run dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Open browser and verify**

Open the demo app. Check the browser console for the `Manifest parsed:` log.
Verify:
- The manifest parses without errors
- Segments are generated (30 segments per track for the 60s presentation)
- Segment URLs follow the pattern `https://www.itec.aau.at/ftp/datasets/mmsys18/BBB/BBB_2sec/x264/segment_100{1..30}.m4s`
- Segment timing: first segment starts at 0, each is 2 seconds, last ends at 60

Note: Full playback may not work due to multi-codec AdaptationSets (H.265, VP9, AV1 may not be browser-supported), but the H.264 AdaptationSet should parse and play correctly.

- [ ] **Step 3: Test that existing SegmentTimeline manifests still work**

Temporarily switch the demo URL back to one of the commented-out SegmentTimeline manifests (e.g., the livesim2 URL) and verify it still parses and plays.

- [ ] **Step 4: Restore the BBB manifest URL and commit if any fixes were needed**

If any fixes were needed, commit them. Otherwise, nothing to commit.
