# Demo Component Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the demo's monolithic `App.tsx` into a proper component structure with single-responsibility files, shared types, and `tailwind-merge` for class composition.

**Architecture:** Extract types to `types.ts`, utility functions to `buffer-graph/utils.ts`, and split the UI into small components: `Table` (generic), `Track`, `Bar`, `Header`, `SeekableLabels`, `Stats`, and `BufferGraph` (composer). Move inline CSS from `index.html` to `app.css`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, tailwind-merge

---

## File Structure

- **Create:** `packages/demo/src/types.ts` — shared types
- **Create:** `packages/demo/src/components/Table.tsx` — generic table
- **Create:** `packages/demo/src/components/buffer-graph/utils.ts` — position/stat helpers
- **Create:** `packages/demo/src/components/buffer-graph/Track.tsx` — range fills + markers
- **Create:** `packages/demo/src/components/buffer-graph/Bar.tsx` — label + Track
- **Create:** `packages/demo/src/components/buffer-graph/Header.tsx` — metrics row
- **Create:** `packages/demo/src/components/buffer-graph/SeekableLabels.tsx` — positioned labels
- **Create:** `packages/demo/src/components/buffer-graph/Stats.tsx` — stats table
- **Create:** `packages/demo/src/components/buffer-graph/BufferGraph.tsx` — composer
- **Modify:** `packages/demo/src/App.tsx` — slim down to getData + App
- **Modify:** `packages/demo/src/app.css` — add video styles
- **Modify:** `packages/demo/index.html` — remove inline styles

---

### Task 1: Install tailwind-merge

**Files:**
- Modify: `packages/demo/package.json`

- [ ] **Step 1: Install tailwind-merge**

```bash
pnpm add tailwind-merge --filter @bap/demo
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/package.json pnpm-lock.yaml
git commit -m "feat(demo): add tailwind-merge dependency"
```

---

### Task 2: Extract shared types

**Files:**
- Create: `packages/demo/src/types.ts`

- [ ] **Step 1: Create types.ts**

Create `packages/demo/src/types.ts`:

```ts
export type TimeRange = {
  start: number;
  end: number;
};

export type BufferData = {
  currentTime: number;
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

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/types.ts
git commit -m "feat(demo): extract shared types to types.ts"
```

---

### Task 3: Extract buffer-graph utils

**Files:**
- Create: `packages/demo/src/components/buffer-graph/utils.ts`

- [ ] **Step 1: Create utils.ts**

Create `packages/demo/src/components/buffer-graph/utils.ts`:

```ts
import type { TimeRange } from "../../types.ts";

/**
 * Converts a time value to a CSS percentage string
 * within the seekable range.
 */
export function toPosition(
  time: number,
  seekable: TimeRange | null,
): string {
  if (!seekable) {
    return "0%";
  }
  const duration = seekable.end - seekable.start;
  if (duration <= 0) {
    return "0%";
  }
  const pct = ((time - seekable.start) / duration) * 100;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

/**
 * Converts a TimeRange to CSS left/width percentage
 * strings within the seekable range.
 */
export function toBarStyle(
  range: TimeRange,
  seekable: TimeRange | null,
): { left: string; width: string } {
  if (!seekable) {
    return { left: "0%", width: "0%" };
  }
  const duration = seekable.end - seekable.start;
  if (duration <= 0) {
    return { left: "0%", width: "0%" };
  }
  const left =
    ((range.start - seekable.start) / duration) * 100;
  const width =
    ((range.end - range.start) / duration) * 100;
  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.min(100 - Math.max(0, left), width)}%`,
  };
}

/**
 * Finds the buffered range containing currentTime
 * and returns ahead/behind distances. Returns null
 * if currentTime is not inside any range.
 */
export function getBufferStat(
  ranges: TimeRange[],
  currentTime: number,
): { ahead: number; behind: number } | null {
  for (const range of ranges) {
    if (currentTime >= range.start && currentTime <= range.end) {
      return {
        ahead: range.end - currentTime,
        behind: currentTime - range.start,
      };
    }
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/buffer-graph/utils.ts
git commit -m "feat(demo): extract buffer-graph utils"
```

---

### Task 4: Create generic Table component

**Files:**
- Create: `packages/demo/src/components/Table.tsx`

- [ ] **Step 1: Create Table.tsx**

Create `packages/demo/src/components/Table.tsx`:

```tsx
type Column = {
  label: string;
  className?: string;
};

type Row = {
  label: string;
  values: string[];
};

type TableProps = {
  columns: Column[];
  rows: Row[];
};

export function Table({ columns, rows }: TableProps) {
  return (
    <table>
      <thead>
        <tr>
          <td className="pr-3" />
          {columns.map((col) => (
            <td key={col.label} className={twMerge("px-3 text-right", col.className)}>
              {col.label}
            </td>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="pr-3">{row.label}</td>
            {row.values.map((value, i) => (
              <td key={columns[i].label} className="px-3 text-right">
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Add the import at the top of the file:

```ts
import { twMerge } from "tailwind-merge";
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/Table.tsx
git commit -m "feat(demo): add generic Table component"
```

---

### Task 5: Create Track component

**Files:**
- Create: `packages/demo/src/components/buffer-graph/Track.tsx`

- [ ] **Step 1: Create Track.tsx**

Create `packages/demo/src/components/buffer-graph/Track.tsx`:

```tsx
import { twMerge } from "tailwind-merge";
import type { TimeRange } from "../../types.ts";
import { toBarStyle, toPosition } from "./utils.ts";

type TrackProps = {
  className?: string;
  rangeClassName?: string;
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: number;
  bufferGoal: number;
  showMarkers?: boolean;
};

export function Track({
  className,
  rangeClassName,
  ranges,
  seekable,
  currentTime,
  bufferGoal,
  showMarkers = true,
}: TrackProps) {
  return (
    <div className={twMerge("relative flex-1 bg-neutral-800 h-4", className)}>
      {ranges.map((range) => {
        const style = toBarStyle(range, seekable);
        return (
          <div
            key={`${range.start}-${range.end}`}
            className={twMerge("absolute top-0 h-full bg-neutral-600", rangeClassName)}
            style={{ left: style.left, width: style.width }}
          />
        );
      })}
      {showMarkers && (
        <>
          <div
            className="absolute top-0 h-full w-0.5 bg-white"
            style={{ left: toPosition(currentTime, seekable) }}
          />
          <div
            className="absolute top-0 h-full border-l border-dashed border-neutral-600"
            style={{
              left: toPosition(currentTime + bufferGoal, seekable),
            }}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/buffer-graph/Track.tsx
git commit -m "feat(demo): add Track component"
```

---

### Task 6: Create Bar component

**Files:**
- Create: `packages/demo/src/components/buffer-graph/Bar.tsx`

- [ ] **Step 1: Create Bar.tsx**

Create `packages/demo/src/components/buffer-graph/Bar.tsx`:

```tsx
import { twMerge } from "tailwind-merge";
import type { TimeRange } from "../../types.ts";
import { Track } from "./Track.tsx";

type BarProps = {
  label: string;
  labelClassName?: string;
  trackClassName?: string;
  rangeClassName?: string;
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: number;
  bufferGoal: number;
  showMarkers?: boolean;
};

export function Bar({
  label,
  labelClassName,
  trackClassName,
  rangeClassName,
  ranges,
  seekable,
  currentTime,
  bufferGoal,
  showMarkers,
}: BarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={twMerge("w-20 text-right", labelClassName)}>
        {label}
      </span>
      <Track
        className={trackClassName}
        rangeClassName={rangeClassName}
        ranges={ranges}
        seekable={seekable}
        currentTime={currentTime}
        bufferGoal={bufferGoal}
        showMarkers={showMarkers}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/buffer-graph/Bar.tsx
git commit -m "feat(demo): add Bar component"
```

---

### Task 7: Create Header component

**Files:**
- Create: `packages/demo/src/components/buffer-graph/Header.tsx`

- [ ] **Step 1: Create Header.tsx**

Create `packages/demo/src/components/buffer-graph/Header.tsx`:

```tsx
type HeaderProps = {
  bufferGoal: number;
  paused: boolean;
};

export function Header({ bufferGoal, paused }: HeaderProps) {
  return (
    <div className="mb-3">
      goal {bufferGoal} · {paused ? "paused" : "playing"}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/buffer-graph/Header.tsx
git commit -m "feat(demo): add Header component"
```

---

### Task 8: Create SeekableLabels component

**Files:**
- Create: `packages/demo/src/components/buffer-graph/SeekableLabels.tsx`

- [ ] **Step 1: Create SeekableLabels.tsx**

Create `packages/demo/src/components/buffer-graph/SeekableLabels.tsx`:

```tsx
import type { TimeRange } from "../../types.ts";
import { toPosition } from "./utils.ts";

type SeekableLabelsProps = {
  seekable: TimeRange | null;
  currentTime: number;
};

export function SeekableLabels({
  seekable,
  currentTime,
}: SeekableLabelsProps) {
  return (
    <div className="relative mb-0.5 ml-22 flex">
      <span>{seekable?.start.toFixed(3) ?? "-"}</span>
      <span
        className="absolute"
        style={{ left: toPosition(currentTime, seekable) }}
      >
        {currentTime.toFixed(3)}
      </span>
      <span className="absolute right-0">
        {seekable?.end.toFixed(3) ?? "-"}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/buffer-graph/SeekableLabels.tsx
git commit -m "feat(demo): add SeekableLabels component"
```

---

### Task 9: Create Stats component

**Files:**
- Create: `packages/demo/src/components/buffer-graph/Stats.tsx`

- [ ] **Step 1: Create Stats.tsx**

Create `packages/demo/src/components/buffer-graph/Stats.tsx`:

```tsx
import type { TimeRange } from "../../types.ts";
import { Table } from "../Table.tsx";
import { getBufferStat } from "./utils.ts";

type StatsProps = {
  buffered: TimeRange[];
  video: TimeRange[];
  audio: TimeRange[];
  currentTime: number;
};

export function Stats({
  buffered,
  video,
  audio,
  currentTime,
}: StatsProps) {
  const totalStat = getBufferStat(buffered, currentTime);
  const videoStat = getBufferStat(video, currentTime);
  const audioStat = getBufferStat(audio, currentTime);

  const fmt = (v: number | undefined) =>
    v !== undefined ? v.toFixed(3) : "-";

  const columns = [
    { label: "total" },
    { label: "video", className: "text-indigo-500" },
    { label: "audio", className: "text-emerald-400" },
  ];

  const rows = [
    {
      label: "ahead",
      values: [
        fmt(totalStat?.ahead),
        fmt(videoStat?.ahead),
        fmt(audioStat?.ahead),
      ],
    },
    {
      label: "behind",
      values: [
        fmt(totalStat?.behind),
        fmt(videoStat?.behind),
        fmt(audioStat?.behind),
      ],
    },
  ];

  return <Table columns={columns} rows={rows} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/buffer-graph/Stats.tsx
git commit -m "feat(demo): add Stats component"
```

---

### Task 10: Create BufferGraph component

**Files:**
- Create: `packages/demo/src/components/buffer-graph/BufferGraph.tsx`

- [ ] **Step 1: Create BufferGraph.tsx**

Create `packages/demo/src/components/buffer-graph/BufferGraph.tsx`:

```tsx
import type { BufferData } from "../../types.ts";
import { Bar } from "./Bar.tsx";
import { Header } from "./Header.tsx";
import { SeekableLabels } from "./SeekableLabels.tsx";
import { Stats } from "./Stats.tsx";

type BufferGraphProps = {
  data: BufferData;
};

export function BufferGraph({ data }: BufferGraphProps) {
  return (
    <div className="bg-neutral-950 p-4 font-mono text-neutral-500">
      <Header bufferGoal={data.bufferGoal} paused={data.paused} />
      <SeekableLabels
        seekable={data.seekable}
        currentTime={data.currentTime}
      />

      <Bar
        label="buffered"
        ranges={data.buffered}
        seekable={data.seekable}
        currentTime={data.currentTime}
        bufferGoal={data.bufferGoal}
      />
      <div className="mb-3">
        <Bar
          label="played"
          trackClassName="h-1"
          ranges={data.played}
          seekable={data.seekable}
          currentTime={data.currentTime}
          bufferGoal={data.bufferGoal}
          showMarkers={false}
        />
      </div>

      <hr className="mb-3" />

      <Bar
        label="video"
        labelClassName="text-indigo-500"
        rangeClassName="bg-indigo-500/30"
        ranges={data.video}
        seekable={data.seekable}
        currentTime={data.currentTime}
        bufferGoal={data.bufferGoal}
      />
      <div className="mb-3">
        <Bar
          label="audio"
          labelClassName="text-emerald-400"
          rangeClassName="bg-emerald-400/30"
          ranges={data.audio}
          seekable={data.seekable}
          currentTime={data.currentTime}
          bufferGoal={data.bufferGoal}
        />
      </div>

      <hr className="mb-3" />

      <Stats
        buffered={data.buffered}
        video={data.video}
        audio={data.audio}
        currentTime={data.currentTime}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/buffer-graph/BufferGraph.tsx
git commit -m "feat(demo): add BufferGraph composer component"
```

---

### Task 11: Slim down App.tsx and update CSS

**Files:**
- Modify: `packages/demo/src/App.tsx`
- Modify: `packages/demo/src/app.css`
- Modify: `packages/demo/index.html`

- [ ] **Step 1: Rewrite App.tsx**

Replace the entire contents of `packages/demo/src/App.tsx` with:

```tsx
import type { Player } from "@bap/player";
import { MediaType } from "@bap/player";
import type { BufferData, TimeRange } from "./types.ts";
import { BufferGraph } from "./components/buffer-graph/BufferGraph.tsx";

/**
 * Converts a native TimeRanges object to an array
 * of TimeRange.
 */
function toTimeRanges(ranges: TimeRanges): TimeRange[] {
  const result: TimeRange[] = [];
  for (let i = 0; i < ranges.length; i++) {
    result.push({
      start: ranges.start(i),
      end: ranges.end(i),
    });
  }
  return result;
}

/**
 * Reads all buffer-related state from the player
 * and video element. Returns null if no media
 * is attached.
 */
function getData(player: Player): BufferData | null {
  const media = player.getMedia();
  if (!media) {
    return null;
  }

  const config = player.getConfig();
  const seekableRanges = toTimeRanges(media.seekable);

  return {
    currentTime: media.currentTime,
    paused: media.paused,
    seekable: seekableRanges[0] ?? null,
    buffered: toTimeRanges(media.buffered),
    played: toTimeRanges(media.played),
    video: toTimeRanges(player.getBuffered(MediaType.VIDEO)),
    audio: toTimeRanges(player.getBuffered(MediaType.AUDIO)),
    bufferGoal: config.bufferGoal,
    bufferBehind: config.bufferBehind,
  };
}

type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  const data = getData(player);
  if (!data) {
    return null;
  }

  return <BufferGraph data={data} />;
}
```

- [ ] **Step 2: Update app.css**

Replace the contents of `packages/demo/src/app.css` with:

```css
@import "tailwindcss";

html {
  font-size: 12px;
}

video {
  width: 100%;
  aspect-ratio: 16 / 9;
}
```

- [ ] **Step 3: Remove inline styles from index.html**

In `packages/demo/index.html`, remove the `<style>` block. The `<head>` should contain only the meta tags, title, and the CSS link:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Barely A Player</title>
    <link rel="stylesheet" href="./src/app.css" />
  </head>
  <body>
    <!-- biome-ignore lint/a11y/useMediaCaption: MSE -->
    <video id="videoElement" controls></video>
    <div id="app"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Run format and type check**

```bash
pnpm format && pnpm tsc
```

Fix any issues.

- [ ] **Step 5: Verify dev server**

Run `pnpm dev` and confirm the buffer visualizer renders identically to before the refactor.

- [ ] **Step 6: Commit**

```bash
git add packages/demo/src/ packages/demo/index.html
git commit -m "refactor(demo): split App.tsx into component structure"
```
