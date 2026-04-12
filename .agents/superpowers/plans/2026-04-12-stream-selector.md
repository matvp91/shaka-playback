# Stream Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stream selector dropdowns to the demo app so users can switch video/audio streams at runtime.

**Architecture:** Pure utility helpers (`utils/stream.ts`) handle formatting and grouping. A stateless `StreamSelector` component reads player state and renders two `<select>` elements. Existing `cn()` moves to `utils/cn.ts` as part of a utils directory restructure.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, `pretty-bytes`, cmaf-lite

---

### File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/utils/cn.ts` | `cn()` helper (moved from `src/utils.ts`) |
| Create | `src/utils/stream.ts` | Stream formatting and grouping helpers |
| Delete | `src/utils.ts` | Replaced by `src/utils/` directory |
| Modify | `src/components/Bar.tsx` | Update `cn` import path |
| Modify | `src/components/Table.tsx` | Update `cn` import path |
| Modify | `src/components/buffer-graph/Track.tsx` | Update `cn` import path |
| Create | `src/components/StreamSelector.tsx` | Stream selector UI component |
| Modify | `src/App.tsx` | Add StreamSelector above BufferGraph |
| Modify | `src/main.tsx` | Remove hardcoded setStreamPreference |

---

### Task 1: Install pretty-bytes

**Files:**
- Modify: `packages/demo/package.json`

- [ ] **Step 1: Install dependency**

```bash
cd packages/demo && pnpm add pretty-bytes
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/package.json pnpm-lock.yaml
git commit -m "chore(demo): add pretty-bytes dependency"
```

---

### Task 2: Restructure utils directory

**Files:**
- Create: `packages/demo/src/utils/cn.ts`
- Delete: `packages/demo/src/utils.ts`
- Modify: `packages/demo/src/components/Bar.tsx`
- Modify: `packages/demo/src/components/Table.tsx`
- Modify: `packages/demo/src/components/buffer-graph/Track.tsx`

- [ ] **Step 1: Create `src/utils/cn.ts`**

```ts
import type { ClassValue } from "clsx";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Update imports in consuming files**

In `Bar.tsx`, `Table.tsx`, and `Track.tsx`, change:
```ts
// Before
import { cn } from "../utils";
// After
import { cn } from "../utils/cn";
```

For `Track.tsx` (deeper nesting):
```ts
// Before
import { cn } from "../../utils";
// After
import { cn } from "../../utils/cn";
```

- [ ] **Step 3: Delete `src/utils.ts`**

```bash
rm packages/demo/src/utils.ts
```

- [ ] **Step 4: Verify build**

```bash
pnpm tsc
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A packages/demo/src/utils packages/demo/src/utils.ts \
  packages/demo/src/components/Bar.tsx \
  packages/demo/src/components/Table.tsx \
  packages/demo/src/components/buffer-graph/Track.tsx
git commit -m "refactor(demo): move cn() to utils directory"
```

---

### Task 3: Create stream utils

**Files:**
- Create: `packages/demo/src/utils/stream.ts`

- [ ] **Step 1: Create `src/utils/stream.ts`**

```ts
import type { ByType, Stream } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import prettyBytes from "pretty-bytes";

type GroupedStreams = {
  video: ByType<Stream, MediaType.VIDEO>[];
  audio: ByType<Stream, MediaType.AUDIO>[];
};

/**
 * Groups streams by media type.
 */
export function groupByType(streams: Stream[]): GroupedStreams {
  const video: ByType<Stream, MediaType.VIDEO>[] = [];
  const audio: ByType<Stream, MediaType.AUDIO>[] = [];

  for (const stream of streams) {
    if (stream.type === MediaType.VIDEO) {
      video.push(stream);
    } else if (stream.type === MediaType.AUDIO) {
      audio.push(stream);
    }
  }

  return { video, audio };
}

/**
 * Formats bandwidth as a human-readable string.
 */
export function formatBandwidth(bps: number): string {
  return `${prettyBytes(bps, { bits: true })}/s`;
}

/**
 * Formats a stream as a human-readable label.
 * Used as display text and as select value/React key.
 */
export function formatStream(stream: Stream): string {
  if (stream.type === MediaType.VIDEO) {
    return `${stream.width}x${stream.height} · ${formatBandwidth(stream.bandwidth)} · ${stream.codec}`;
  }
  return `${formatBandwidth(stream.bandwidth)} · ${stream.codec}`;
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm tsc
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/demo/src/utils/stream.ts
git commit -m "feat(demo): add stream formatting and grouping utils"
```

---

### Task 4: Create StreamSelector component

**Files:**
- Create: `packages/demo/src/components/StreamSelector.tsx`

- [ ] **Step 1: Create `src/components/StreamSelector.tsx`**

```tsx
import type { Player, Stream } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { formatStream, groupByType } from "../utils/stream";

type StreamSelectorProps = {
  player: Player;
};

/**
 * Finds the label of the stream matching the current
 * preference, or returns empty string if none.
 */
function activeLabel(player: Player, type: MediaType, streams: Stream[]): string {
  const pref = player.getStreamPreference(type);
  if (!pref) {
    return "";
  }

  for (const stream of streams) {
    if (stream.type === MediaType.VIDEO && pref.type === MediaType.VIDEO) {
      if (
        stream.height === pref.height &&
        stream.width === pref.width &&
        stream.bandwidth === pref.bandwidth
      ) {
        return formatStream(stream);
      }
    } else if (stream.type === MediaType.AUDIO && pref.type === MediaType.AUDIO) {
      if (
        stream.bandwidth === pref.bandwidth &&
        stream.codec === pref.codec
      ) {
        return formatStream(stream);
      }
    }
  }

  return "";
}

function onSelect(player: Player, streams: Stream[], label: string) {
  const stream = streams.find((s) => formatStream(s) === label);
  if (!stream) {
    return;
  }

  if (stream.type === MediaType.VIDEO) {
    player.setStreamPreference(
      MediaType.VIDEO,
      {
        height: stream.height,
        width: stream.width,
        bandwidth: stream.bandwidth,
      },
      true,
    );
  } else if (stream.type === MediaType.AUDIO) {
    player.setStreamPreference(
      MediaType.AUDIO,
      {
        bandwidth: stream.bandwidth,
        codec: stream.codec,
      },
      true,
    );
  }
}

type GroupSelectProps = {
  label: string;
  labelClassName: string;
  streams: Stream[];
  value: string;
  onSelect: (label: string) => void;
};

function GroupSelect({
  label,
  labelClassName,
  streams,
  value,
  onSelect,
}: GroupSelectProps) {
  if (streams.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <span className={`w-20 text-right ${labelClassName}`}>{label}</span>
      <select
        className="flex-1 bg-neutral-900 px-2 py-1 text-sm text-neutral-300 outline-none"
        value={value}
        onChange={(e) => onSelect(e.target.value)}
      >
        {streams.map((stream) => {
          const streamLabel = formatStream(stream);
          return (
            <option key={streamLabel} value={streamLabel}>
              {streamLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}

export function StreamSelector({ player }: StreamSelectorProps) {
  let streams: Stream[];
  try {
    streams = player.getStreams();
  } catch {
    return null;
  }

  const grouped = groupByType(streams);

  return (
    <div className="flex flex-col gap-1">
      <GroupSelect
        label="video"
        labelClassName="text-indigo-500"
        streams={grouped.video}
        value={activeLabel(player, MediaType.VIDEO, grouped.video)}
        onSelect={(label) => onSelect(player, grouped.video, label)}
      />
      <GroupSelect
        label="audio"
        labelClassName="text-emerald-400"
        streams={grouped.audio}
        value={activeLabel(player, MediaType.AUDIO, grouped.audio)}
        onSelect={(label) => onSelect(player, grouped.audio, label)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm tsc
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/demo/src/components/StreamSelector.tsx
git commit -m "feat(demo): add StreamSelector component"
```

---

### Task 5: Integrate into App

**Files:**
- Modify: `packages/demo/src/App.tsx`
- Modify: `packages/demo/src/main.tsx`

- [ ] **Step 1: Add StreamSelector to App.tsx**

Add import at top:
```ts
import { StreamSelector } from "./components/StreamSelector";
```

Update the return in `App`:
```tsx
return (
  <>
    <StreamSelector player={player} />
    <BufferGraph data={data} />
  </>
);
```

- [ ] **Step 2: Remove hardcoded preference from main.tsx**

Remove this line from `main.tsx`:
```ts
player.setStreamPreference(MediaType.VIDEO, { height: 720 });
```

Also remove `MediaType` from the import if no longer used:
```ts
// Before
import {
  Log,
  LogLevel,
  MediaType,
  Player,
  Registry,
  RegistryType,
} from "cmaf-lite";

// After
import {
  Log,
  LogLevel,
  Player,
  Registry,
  RegistryType,
} from "cmaf-lite";
```

- [ ] **Step 3: Verify build**

```bash
pnpm tsc
```

Expected: no errors.

- [ ] **Step 4: Manual test in browser**

```bash
pnpm dev
```

Verify:
- Two dropdowns appear (video and audio) above the buffer graph
- Video dropdown lists streams with resolution, bandwidth, and codec
- Audio dropdown lists streams with bandwidth and codec
- Changing a dropdown triggers a stream switch (buffer flushes, new quality loads)
- Selected value reflects the active stream preference

- [ ] **Step 5: Commit**

```bash
git add packages/demo/src/App.tsx packages/demo/src/main.tsx
git commit -m "feat(demo): integrate stream selector into app"
```
