# Fix DASH $Number$ Template Substitution

## Problem

In `mapTemplateTimeline` (`lib/dash/dash_presentation.ts`), the `$Number$` template variable is never incremented. Every segment in a period receives the same number (`startNumber`), producing identical URLs for all segments.

For example, with `startNumber="1"` and 15 segments, all segment URLs resolve to `segment_1.mp4` instead of `segment_1.mp4` through `segment_15.mp4`.

## Root Cause

Line 88 passes `Number: startNumber` to `applyUrlTemplate` inside the segment loop, but `startNumber` is a constant — it never changes.

## Fix

In the `mapTemplateTimeline` function:

1. Add `let number = startNumber` before the outer `for` loop, alongside the existing `let time = 0`.
2. Replace `Number: startNumber` with `Number: number` in the `applyUrlTemplate` call.
3. Add `number++` after each segment push, inside the inner `for` loop.

`$Time$` substitution is already correct — the `time` variable is properly tracked and passed through.

## Expected Behavior (Reference Manifest)

| Period | startNumber | Segments | Number range |
|--------|-------------|----------|--------------|
| 1      | 1           | 15       | 1-15         |
| 3      | 16          | 45       | 16-60        |
| 5      | 61          | 60       | 61-120       |
| 7      | 121         | 197      | 121-317      |

## Affected Files

- `lib/dash/dash_presentation.ts` — `mapTemplateTimeline` function (lines 63-100)
