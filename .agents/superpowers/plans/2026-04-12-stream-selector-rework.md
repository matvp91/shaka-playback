# Stream Selector Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the StreamSelector dropdown with a read-only stream list and preference forms using shadcn, react-hook-form, and zod.

**Architecture:** Two new component groups (stream-list, preferences) replace the single StreamSelector. Components call player methods directly — no extraction layer. Forms use react-hook-form with zodResolver for validation.

**Tech Stack:** React 19, shadcn, react-hook-form, @hookform/resolvers, zod, Tailwind CSS v4

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/demo/package.json`

- [ ] **Step 1: Install shadcn dependencies**

```bash
cd packages/demo && pnpm add zod react-hook-form @hookform/resolvers
```

- [ ] **Step 2: Initialize shadcn**

```bash
cd packages/demo && pnpm dlx shadcn@latest init
```

When prompted, select the defaults. This creates `components.json` and sets up the shadcn infrastructure.

- [ ] **Step 3: Add shadcn components needed**

```bash
cd packages/demo && pnpm dlx shadcn@latest add input button label
```

- [ ] **Step 4: Verify the dev server starts**

```bash
cd packages/demo && pnpm dev
```

Expected: vite dev server starts without errors.

- [ ] **Step 5: Commit**

```bash
git add packages/demo/
git commit -m "chore(demo): add shadcn, react-hook-form, zod"
```

---

### Task 2: Create StreamItem component

**Files:**
- Create: `packages/demo/src/components/stream-list/StreamItem.tsx`

- [ ] **Step 1: Create StreamItem**

```tsx
import type { Stream } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { formatBandwidth } from "../../utils/stream";

type StreamItemProps = {
  stream: Stream;
  active: boolean;
};

export function StreamItem({ stream, active }: StreamItemProps) {
  return (
    <div className="flex items-center gap-2">
      {active && <span>●</span>}
      {stream.type === MediaType.VIDEO ? (
        <span>
          {stream.width}x{stream.height} · {formatBandwidth(stream.bandwidth)}{" "}
          · {stream.codec}
        </span>
      ) : (
        <span>
          {formatBandwidth(stream.bandwidth)} · {stream.codec}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/stream-list/StreamItem.tsx
git commit -m "feat(demo): add StreamItem component"
```

---

### Task 3: Create StreamGroup component

**Files:**
- Create: `packages/demo/src/components/stream-list/StreamGroup.tsx`

- [ ] **Step 1: Create StreamGroup**

```tsx
import type { Player, Stream } from "cmaf-lite";
import type { MediaType } from "cmaf-lite";
import { StreamItem } from "./StreamItem";
import { formatStream } from "../../utils/stream";

type StreamGroupProps = {
  label: string;
  streams: Stream[];
  player: Player;
  type: MediaType;
};

export function StreamGroup({ label, streams, player, type }: StreamGroupProps) {
  if (streams.length === 0) {
    return null;
  }

  let activeStream: Stream | null = null;
  try {
    activeStream = player.getActiveStream(type);
  } catch {
    // No active stream yet.
  }

  return (
    <div>
      <h3>{label}</h3>
      {streams.map((stream) => (
        <StreamItem
          key={formatStream(stream)}
          stream={stream}
          active={
            activeStream !== null &&
            formatStream(stream) === formatStream(activeStream)
          }
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/stream-list/StreamGroup.tsx
git commit -m "feat(demo): add StreamGroup component"
```

---

### Task 4: Create StreamList component

**Files:**
- Create: `packages/demo/src/components/stream-list/StreamList.tsx`

- [ ] **Step 1: Create StreamList**

```tsx
import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { groupByType } from "../../utils/stream";
import { StreamGroup } from "./StreamGroup";

type StreamListProps = {
  player: Player;
};

export function StreamList({ player }: StreamListProps) {
  let streams;
  try {
    streams = player.getStreams();
  } catch {
    return null;
  }

  const grouped = groupByType(streams);

  return (
    <div>
      <StreamGroup
        label="video"
        streams={grouped.video}
        player={player}
        type={MediaType.VIDEO}
      />
      <StreamGroup
        label="audio"
        streams={grouped.audio}
        player={player}
        type={MediaType.AUDIO}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/stream-list/StreamList.tsx
git commit -m "feat(demo): add StreamList component"
```

---

### Task 5: Create VideoPreferenceForm component

**Files:**
- Create: `packages/demo/src/components/preferences/VideoPreferenceForm.tsx`

- [ ] **Step 1: Create VideoPreferenceForm**

```tsx
import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const schema = z.object({
  width: z.coerce.number().positive().optional().or(z.literal("")),
  height: z.coerce.number().positive().optional().or(z.literal("")),
  bandwidth: z.coerce.number().positive().optional().or(z.literal("")),
  codec: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type VideoPreferenceFormProps = {
  player: Player;
};

export function VideoPreferenceForm({ player }: VideoPreferenceFormProps) {
  const { register, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  function onSubmit(values: FormValues) {
    player.setStreamPreference(
      {
        type: MediaType.VIDEO,
        ...(typeof values.width === "number" && { width: values.width }),
        ...(typeof values.height === "number" && { height: values.height }),
        ...(typeof values.bandwidth === "number" && {
          bandwidth: values.bandwidth,
        }),
        ...(values.codec && { codec: values.codec }),
      },
      true,
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h3>video</h3>
      <div>
        <Label htmlFor="video-width">width</Label>
        <Input id="video-width" type="number" {...register("width")} />
      </div>
      <div>
        <Label htmlFor="video-height">height</Label>
        <Input id="video-height" type="number" {...register("height")} />
      </div>
      <div>
        <Label htmlFor="video-bandwidth">bandwidth</Label>
        <Input
          id="video-bandwidth"
          type="number"
          {...register("bandwidth")}
        />
      </div>
      <div>
        <Label htmlFor="video-codec">codec</Label>
        <Input id="video-codec" type="text" {...register("codec")} />
      </div>
      <Button type="submit">Set video preference</Button>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/preferences/VideoPreferenceForm.tsx
git commit -m "feat(demo): add VideoPreferenceForm component"
```

---

### Task 6: Create AudioPreferenceForm component

**Files:**
- Create: `packages/demo/src/components/preferences/AudioPreferenceForm.tsx`

- [ ] **Step 1: Create AudioPreferenceForm**

```tsx
import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const schema = z.object({
  bandwidth: z.coerce.number().positive().optional().or(z.literal("")),
  codec: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

type AudioPreferenceFormProps = {
  player: Player;
};

export function AudioPreferenceForm({ player }: AudioPreferenceFormProps) {
  const { register, handleSubmit } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  function onSubmit(values: FormValues) {
    player.setStreamPreference(
      {
        type: MediaType.AUDIO,
        ...(typeof values.bandwidth === "number" && {
          bandwidth: values.bandwidth,
        }),
        ...(values.codec && { codec: values.codec }),
      },
      true,
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <h3>audio</h3>
      <div>
        <Label htmlFor="audio-bandwidth">bandwidth</Label>
        <Input
          id="audio-bandwidth"
          type="number"
          {...register("bandwidth")}
        />
      </div>
      <div>
        <Label htmlFor="audio-codec">codec</Label>
        <Input id="audio-codec" type="text" {...register("codec")} />
      </div>
      <Button type="submit">Set audio preference</Button>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/preferences/AudioPreferenceForm.tsx
git commit -m "feat(demo): add AudioPreferenceForm component"
```

---

### Task 7: Create Preferences component

**Files:**
- Create: `packages/demo/src/components/preferences/Preferences.tsx`

- [ ] **Step 1: Create Preferences**

```tsx
import type { Player } from "cmaf-lite";
import { AudioPreferenceForm } from "./AudioPreferenceForm";
import { VideoPreferenceForm } from "./VideoPreferenceForm";

type PreferencesProps = {
  player: Player;
};

export function Preferences({ player }: PreferencesProps) {
  return (
    <div>
      <VideoPreferenceForm player={player} />
      <AudioPreferenceForm player={player} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/components/preferences/Preferences.tsx
git commit -m "feat(demo): add Preferences component"
```

---

### Task 8: Update App.tsx and clean up

**Files:**
- Modify: `packages/demo/src/App.tsx`
- Delete: `packages/demo/src/components/StreamSelector.tsx`

- [ ] **Step 1: Update App.tsx**

Replace the full contents of `App.tsx` with:

```tsx
import type { Player } from "cmaf-lite";
import { MediaType } from "cmaf-lite";
import { BufferGraph } from "./components/buffer-graph/BufferGraph";
import { Preferences } from "./components/preferences/Preferences";
import { StreamList } from "./components/stream-list/StreamList";
import type { BufferData, TimeRange } from "./types";

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

type AppProps = {
  player: Player;
};

export function App({ player }: AppProps) {
  const media = player.getMedia();
  if (!media) {
    return null;
  }

  const config = player.getConfig();
  const seekableRanges = toTimeRanges(media.seekable);

  const video = player.getBuffered(MediaType.VIDEO);
  const audio = player.getBuffered(MediaType.AUDIO);

  const data: BufferData = {
    currentTime: media.currentTime,
    paused: media.paused,
    seekable: seekableRanges[0] ?? null,
    buffered: toTimeRanges(media.buffered),
    played: toTimeRanges(media.played),
    video: video ? toTimeRanges(video) : [],
    audio: audio ? toTimeRanges(audio) : [],
    frontBufferLength: config.frontBufferLength,
    backBufferLength: config.backBufferLength,
  };

  return (
    <>
      <div className="flex">
        <StreamList player={player} />
        <Preferences player={player} />
      </div>
      <BufferGraph data={data} />
    </>
  );
}
```

Note: `getBuffered` now returns `TimeRanges | null`, so we handle the null case.

- [ ] **Step 2: Delete StreamSelector**

```bash
rm packages/demo/src/components/StreamSelector.tsx
```

- [ ] **Step 3: Verify type-check passes**

```bash
pnpm tsc
```

- [ ] **Step 4: Verify dev server starts and UI works**

```bash
pnpm dev
```

Open browser and confirm: stream list shows grouped streams with active indicator, preference forms submit correctly, buffer graph still renders.

- [ ] **Step 5: Commit**

```bash
git add -A packages/demo/src/
git commit -m "feat(demo): wire up StreamList and Preferences, remove StreamSelector"
```

---

### Task 9: Clean up non-structural styles from existing components

**Files:**
- Modify: `packages/demo/src/components/Bar.tsx`
- Modify: `packages/demo/src/components/Table.tsx`

- [ ] **Step 1: Review Bar.tsx and Table.tsx for non-structural styles**

Audit both components. Remove visual styles (colors, font sizes) but keep structural styles (flex, positioning, spacing).

`Bar.tsx` — keep `flex items-center gap-2` and `w-20 text-right` (structural). Remove any color classes passed via `labelClassName`.

`Table.tsx` — keep `px-3 text-right pr-3` (structural spacing). No color styles to remove.

- [ ] **Step 2: Update Bar.tsx**

Remove `labelClassName` prop since it was only used for color styling:

```tsx
import type { ReactNode } from "react";

type BarProps = {
  label: string;
  children: ReactNode;
};

export function Bar({ label, children }: BarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-right">{label}</span>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Update callers of Bar that pass labelClassName**

Search for `labelClassName` usage and remove the prop from call sites.

- [ ] **Step 4: Verify type-check and dev server**

```bash
pnpm tsc && pnpm dev
```

- [ ] **Step 5: Commit**

```bash
git add packages/demo/src/
git commit -m "refactor(demo): remove non-structural styles from Bar"
```
