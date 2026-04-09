# Buffer Visualizer Design

Debug tool for the demo package that visualizes the current buffer state of the player.

## Overview

A React component in `App.tsx` that renders a real-time buffer visualization. A pure `getData` function queries the player's public API and the video element every render cycle (250ms interval, already in place) and returns a flat data object. The component renders buffer bars and statistics from this object.

No changes to the player package. No event listeners. Pure derivation on render.

## Data Model

```ts
type TimeRange = { start: string; end: string };

type BufferData = {
  currentTime: string;
  paused: boolean;
  seekable: TimeRange | null;
  buffered: TimeRange[];
  played: TimeRange[];
  video: TimeRange[];
  audio: TimeRange[];
  bufferGoal: number;
  bufferBehind: number;
};
```

All time values are `toFixed(3)` strings.

### Data Sources

| Field | Source |
|-------|--------|
| `currentTime` | `video.currentTime` |
| `paused` | `video.paused` |
| `seekable` | `video.seekable` (first range, or null) |
| `buffered` | `video.buffered` (all ranges) |
| `played` | `video.played` (all ranges) |
| `video` | `player.getBuffered(MediaType.VIDEO)` (all ranges) |
| `audio` | `player.getBuffered(MediaType.AUDIO)` (all ranges) |
| `bufferGoal` | `player.getConfig().bufferGoal` |
| `bufferBehind` | `player.getConfig().bufferBehind` |

### `getData` Function

Pure function: `getData(player: Player) => BufferData | null`.

Returns `null` when the video element is not available (`player.getMedia()` returns null). Converts native `TimeRanges` objects into `TimeRange[]` arrays via a helper function.

## Visual Layout

The bar range is defined by `video.seekable`. All buffered/played ranges are positioned proportionally within this range. The component uses Tailwind CSS with dark mode as the default theme. Minimal styling — lean on defaults, few class names.

### Structure (top to bottom)

1. **Metrics row** — `goal {bufferGoal} · paused` (or playing)
2. **Seekable labels** — seekable start (left), currentTime (positioned at playhead), seekable end (right)
3. **Buffered bar** — `video.buffered` ranges, with:
   - White playhead line at currentTime
   - Dashed line at bufferGoal position (currentTime + bufferGoal)
4. **Played bar** — thin bar showing `video.played` ranges
5. **Divider**
6. **Video bar** — `player.getBuffered(VIDEO)` ranges, same playhead + goal markers
7. **Audio bar** — `player.getBuffered(AUDIO)` ranges, same playhead + goal markers
8. **Divider**
9. **Stats table** — left-aligned, not stretched, columns: total / video / audio, rows: ahead / behind

### Bar Colors

- Buffered (total): neutral gray
- Played: neutral gray, thinner
- Video: indigo
- Audio: emerald
- Playhead: white
- Buffer goal: dashed, muted

### Statistics

Buffer ahead and buffer behind, derived from TimeRanges + currentTime:
- **ahead** = end of buffered range containing currentTime minus currentTime
- **behind** = currentTime minus start of buffered range containing currentTime
- If currentTime is not inside any buffered range, show `-` for that type

Shown per type (total, video, audio) in a left-aligned table with right-aligned numbers.

## Code Organization

All code lives in `App.tsx`. Functions follow SRP, YAGNI, and DRY:

- `getData(player)` — pure data extraction
- `toTimeRanges(ranges)` — converts native `TimeRanges` to `TimeRange[]`
- `toPosition(time, seekable)` — converts a time value to a percentage position within the seekable range
- `BufferGraph` component — renders the visualization from `BufferData`
- Bar rendering helper — renders a single labeled bar with ranges, playhead, and goal marker

## Dependencies

- Tailwind CSS (new dependency for demo package)
- React (already present)
- `@bap/player` public API (no changes)

## Out of Scope

- Event-driven history/timeline visualization (future tool)
- Stream info (codec, resolution)
- Segment-level metadata
- Changes to the player package
