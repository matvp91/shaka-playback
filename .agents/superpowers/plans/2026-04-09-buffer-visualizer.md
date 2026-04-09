# Buffer Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a debug buffer visualizer in the demo app that shows current buffer state as horizontal bars with statistics.

**Architecture:** Pure `getData` function queries the player's public API and video element every 250ms render cycle. A `BufferGraph` React component renders bars and stats from the returned data object. All code in `App.tsx`, Tailwind CSS for styling.

**Tech Stack:** React 19, Tailwind CSS v4, Vite 8, TypeScript

---

## File Structure

- **Modify:** `packages/demo/package.json` — add Tailwind dependency
- **Create:** `packages/demo/src/app.css` — Tailwind import
- **Modify:** `packages/demo/src/main.tsx` — import CSS
- **Modify:** `packages/demo/index.html` — add `dark` class to `<html>`
- **Modify:** `packages/demo/src/App.tsx` — `getData`, helper functions, `BufferGraph` component

---

### Task 1: Add Tailwind CSS to Demo Package

**Files:**
- Modify: `packages/demo/package.json`
- Create: `packages/demo/src/app.css`
- Modify: `packages/demo/src/main.tsx`
- Modify: `packages/demo/index.html`

- [ ] **Step 1: Install Tailwind CSS v4**

Run from the repo root:

```bash
pnpm add -D tailwindcss @tailwindcss/vite --filter @bap/demo
```

- [ ] **Step 2: Add Tailwind Vite plugin**

Update `packages/demo/vite.config.ts`:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
});
```

- [ ] **Step 3: Create CSS entry file**

Create `packages/demo/src/app.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Import CSS in main.tsx**

Add at the top of `packages/demo/src/main.tsx`:

```ts
import "./app.css";
```

- [ ] **Step 5: Add dark class to HTML**

In `packages/demo/index.html`, change `<html lang="en">` to:

```html
<html lang="en" class="dark">
```

- [ ] **Step 6: Verify Tailwind is working**

Run `pnpm dev` and confirm the page loads without errors. The video and app div should still render.

- [ ] **Step 7: Commit**

```bash
git add packages/demo/
git commit -m "feat(demo): add Tailwind CSS v4"
```

---

### Task 2: Data Layer — `toTimeRanges` and `getData`

**Files:**
- Modify: `packages/demo/src/App.tsx`

- [ ] **Step 1: Add types and `toTimeRanges` helper**

Add to `packages/demo/src/App.tsx`:

```tsx
import { MediaType } from "@bap/player";
import type { Player } from "@bap/player";

type TimeRange = {
  start: string;
  end: string;
};

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

/**
 * Converts a native TimeRanges object to an array
 * of TimeRange with toFixed(3) values.
 */
function toTimeRanges(ranges: TimeRanges): TimeRange[] {
  const result: TimeRange[] = [];
  for (let i = 0; i < ranges.length; i++) {
    result.push({
      start: ranges.start(i).toFixed(3),
      end: ranges.end(i).toFixed(3),
    });
  }
  return result;
}
```

- [ ] **Step 2: Add `getData` function**

Add below `toTimeRanges` in `packages/demo/src/App.tsx`:

```tsx
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
    currentTime: media.currentTime.toFixed(3),
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
```

- [ ] **Step 3: Update App component to call getData**

Update the `App` component in `packages/demo/src/App.tsx` to call `getData` and render the raw data as JSON for now (the `BufferGraph` component comes in a later task):

```tsx
type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  const data = getData(player);
  if (!data) {
    return null;
  }

  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
```

- [ ] **Step 4: Verify dev server**

Run `pnpm dev` and load the page. The JSON output should appear below the video, showing all buffer data fields updating every 250ms.

- [ ] **Step 5: Commit**

```bash
git add packages/demo/src/App.tsx
git commit -m "feat(demo): add getData and buffer data types"
```

---

### Task 3: Position Helper

**Files:**
- Modify: `packages/demo/src/App.tsx`

- [ ] **Step 1: Add `toPosition` helper**

Add below `toTimeRanges` in `packages/demo/src/App.tsx`:

```tsx
/**
 * Converts a time value to a CSS percentage string
 * within the seekable range. Returns "0%" if seekable
 * is null.
 */
function toPosition(time: string, seekable: TimeRange | null): string {
  if (!seekable) {
    return "0%";
  }
  const start = Number(seekable.start);
  const end = Number(seekable.end);
  const duration = end - start;
  if (duration <= 0) {
    return "0%";
  }
  const pct = ((Number(time) - start) / duration) * 100;
  return `${Math.max(0, Math.min(100, pct))}%`;
}

/**
 * Converts a TimeRange to CSS left/width percentage
 * strings within the seekable range.
 */
function toBarStyle(
  range: TimeRange,
  seekable: TimeRange | null,
): { left: string; width: string } {
  if (!seekable) {
    return { left: "0%", width: "0%" };
  }
  const start = Number(seekable.start);
  const end = Number(seekable.end);
  const duration = end - start;
  if (duration <= 0) {
    return { left: "0%", width: "0%" };
  }
  const left = ((Number(range.start) - start) / duration) * 100;
  const width =
    ((Number(range.end) - Number(range.start)) / duration) * 100;
  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.min(100 - Math.max(0, left), width)}%`,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/App.tsx
git commit -m "feat(demo): add position and bar style helpers"
```

---

### Task 4: Statistics Helper

**Files:**
- Modify: `packages/demo/src/App.tsx`

- [ ] **Step 1: Add `getBufferStat` helper**

Add below position helpers in `packages/demo/src/App.tsx`:

```tsx
/**
 * Finds the buffered range containing currentTime
 * and returns ahead/behind distances. Returns null
 * if currentTime is not inside any range.
 */
function getBufferStat(
  ranges: TimeRange[],
  currentTime: string,
): { ahead: string; behind: string } | null {
  const ct = Number(currentTime);
  for (const range of ranges) {
    const start = Number(range.start);
    const end = Number(range.end);
    if (ct >= start && ct <= end) {
      return {
        ahead: (end - ct).toFixed(3),
        behind: (ct - start).toFixed(3),
      };
    }
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/App.tsx
git commit -m "feat(demo): add buffer statistics helper"
```

---

### Task 5: BufferGraph Component — Bars

**Files:**
- Modify: `packages/demo/src/App.tsx`

- [ ] **Step 1: Add Bar helper component**

Add in `packages/demo/src/App.tsx`:

```tsx
function Bar({
  label,
  labelColor,
  ranges,
  seekable,
  currentTime,
  bufferGoal,
  thin,
}: {
  label: string;
  labelColor?: string;
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: string;
  bufferGoal: number;
  thin?: boolean;
}) {
  const goalTime = (Number(currentTime) + bufferGoal).toFixed(3);

  return (
    <div className="flex items-center gap-2">
      <span
        className="w-14 text-right text-[10px]"
        style={labelColor ? { color: labelColor } : undefined}
      >
        {label}
      </span>
      <div
        className={`relative flex-1 bg-neutral-900 ${thin ? "h-1" : "h-4"}`}
      >
        {ranges.map((range, i) => {
          const style = toBarStyle(range, seekable);
          return (
            <div
              key={i}
              className={`absolute top-0 ${thin ? "h-1" : "h-4"} ${labelColor ? "" : "bg-neutral-700"}`}
              style={{
                left: style.left,
                width: style.width,
                ...(labelColor
                  ? { backgroundColor: `color-mix(in srgb, ${labelColor} 30%, transparent)` }
                  : {}),
              }}
            />
          );
        })}
        {!thin && (
          <>
            <div
              className="absolute top-0 h-full w-0.5 bg-white"
              style={{ left: toPosition(currentTime, seekable) }}
            />
            <div
              className="absolute top-0 h-full border-l border-dashed border-neutral-600"
              style={{ left: toPosition(goalTime, seekable) }}
            />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/App.tsx
git commit -m "feat(demo): add Bar component"
```

---

### Task 6: BufferGraph Component — Full Assembly

**Files:**
- Modify: `packages/demo/src/App.tsx`

- [ ] **Step 1: Add BufferGraph component**

Add in `packages/demo/src/App.tsx`:

```tsx
function BufferGraph({ data }: { data: BufferData }) {
  const totalStat = getBufferStat(data.buffered, data.currentTime);
  const videoStat = getBufferStat(data.video, data.currentTime);
  const audioStat = getBufferStat(data.audio, data.currentTime);

  return (
    <div className="bg-neutral-950 p-4 font-mono text-xs text-neutral-500">
      {/* Metrics */}
      <div className="mb-3">
        goal {data.bufferGoal} · {data.paused ? "paused" : "playing"}
      </div>

      {/* Seekable labels */}
      <div className="relative mb-0.5 ml-16 flex text-[10px]">
        <span>{data.seekable?.start ?? "-"}</span>
        <span
          className="absolute text-white"
          style={{ left: toPosition(data.currentTime, data.seekable) }}
        >
          {data.currentTime}
        </span>
        <span className="absolute right-0">
          {data.seekable?.end ?? "-"}
        </span>
      </div>

      {/* Buffered + Played */}
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
          ranges={data.played}
          seekable={data.seekable}
          currentTime={data.currentTime}
          bufferGoal={data.bufferGoal}
          thin
        />
      </div>

      <hr className="mb-3 border-neutral-900" />

      {/* Per-type bars */}
      <Bar
        label="video"
        labelColor="#6366f1"
        ranges={data.video}
        seekable={data.seekable}
        currentTime={data.currentTime}
        bufferGoal={data.bufferGoal}
      />
      <div className="mb-3">
        <Bar
          label="audio"
          labelColor="#34d399"
          ranges={data.audio}
          seekable={data.seekable}
          currentTime={data.currentTime}
          bufferGoal={data.bufferGoal}
        />
      </div>

      <hr className="mb-3 border-neutral-900" />

      {/* Stats table */}
      <table className="text-[11px]">
        <thead>
          <tr className="text-neutral-600">
            <td className="pr-3" />
            <td className="px-3 text-right text-neutral-400">total</td>
            <td className="px-3 text-right" style={{ color: "#6366f1" }}>
              video
            </td>
            <td className="px-3 text-right" style={{ color: "#34d399" }}>
              audio
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="pr-3">ahead</td>
            <td className="px-3 text-right text-white">
              {totalStat?.ahead ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {videoStat?.ahead ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {audioStat?.ahead ?? "-"}
            </td>
          </tr>
          <tr>
            <td className="pr-3">behind</td>
            <td className="px-3 text-right text-white">
              {totalStat?.behind ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {videoStat?.behind ?? "-"}
            </td>
            <td className="px-3 text-right text-white">
              {audioStat?.behind ?? "-"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Update App to use BufferGraph**

Replace the JSON placeholder in the `App` component:

```tsx
export function App({ player }: AppProps) {
  const data = getData(player);
  if (!data) {
    return null;
  }

  return <BufferGraph data={data} />;
}
```

- [ ] **Step 3: Verify dev server**

Run `pnpm dev` and load the page. The buffer visualizer should appear below the video element with:
- Metrics row showing goal and paused/playing state
- Seekable labels with currentTime positioned at playhead
- Buffered and played bars
- Video and audio bars with colored fills
- Stats table showing ahead/behind per type

- [ ] **Step 4: Run format and type check**

```bash
pnpm format && pnpm tsc
```

Fix any issues that come up.

- [ ] **Step 5: Commit**

```bash
git add packages/demo/src/App.tsx
git commit -m "feat(demo): add BufferGraph component with stats"
```
