# Demo Component Structure Design

Refactor the demo package's `App.tsx` into a proper component structure with single-responsibility components, no side effects in components, and shared types/utils.

## File Structure

```
src/
  main.tsx               — player setup, render loop (unchanged)
  app.css                — tailwind import, base styles (video, html font-size)
  App.tsx                — getData, App component
  types.ts               — TimeRange, BufferData
  components/
    Table.tsx            — generic table (columns + rows)
    buffer-graph/
      BufferGraph.tsx    — composes all sections
      Header.tsx         — goal + paused/playing
      SeekableLabels.tsx — start / currentTime / end
      Bar.tsx            — label + Track in a row
      Track.tsx          — range fills + markers
      Stats.tsx          — builds data, renders Table
      utils.ts           — toPosition, toBarStyle, getBufferStat
```

## Conventions

- Named type definitions above the component, not inline
- Component prop types are not exported — internal to the file
- Shared types in `types.ts` are exported
- Components do not introduce side effects
- Each file has one component
- Use `className` props instead of inline `style` for colors — rely on Tailwind classes
- Use `tailwind-merge` for merging class names (new dependency)

## Shared Types — `types.ts`

```ts
type TimeRange = {
  start: number;
  end: number;
};

type BufferData = {
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

Both types are exported from `types.ts` since they're shared between `App.tsx` and components.

## Data Layer — `App.tsx`

Contains `toTimeRanges` helper, `getData` function, and the `App` component. `getData` is the only place that reads from the player/video element — all components receive data as props.

## Generic Component — `Table.tsx`

```ts
type TableProps = {
  columns: { label: string; className?: string }[];
  rows: { label: string; values: string[] }[];
};
```

Renders a simple table with column headers and rows. Knows nothing about buffers.

## Buffer Graph Components

### `Track.tsx` — core rendering primitive

```ts
type TrackProps = {
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: number;
  bufferGoal: number;
  rangeClassName?: string;
  thin?: boolean;
};
```

`rangeClassName` controls the fill color of range blocks (e.g. `bg-indigo-500/30`). Defaults to `bg-neutral-600` when not provided.

Renders a `position: relative` container with:
- Range fills positioned via `toBarStyle`
- Playhead marker (white line) at `currentTime`
- Goal marker (dashed line) at `currentTime + bufferGoal`
- Skips markers when `thin` is true

### `Bar.tsx` — label + Track

```ts
type BarProps = {
  label: string;
  labelClassName?: string;
  rangeClassName?: string;
  ranges: TimeRange[];
  seekable: TimeRange | null;
  currentTime: number;
  bufferGoal: number;
  thin?: boolean;
};
```

Renders a fixed-width label on the left and a `Track` on the right. Passes track-related props through to `Track`.

### `Header.tsx`

```ts
type HeaderProps = {
  bufferGoal: number;
  paused: boolean;
};
```

Renders: `goal {bufferGoal} · paused/playing`.

### `SeekableLabels.tsx`

```ts
type SeekableLabelsProps = {
  seekable: TimeRange | null;
  currentTime: number;
};
```

Renders seekable start (left), currentTime (positioned at playhead %), seekable end (right). Uses `toPosition` from utils.

### `Stats.tsx`

```ts
type StatsProps = {
  buffered: TimeRange[];
  video: TimeRange[];
  audio: TimeRange[];
  currentTime: number;
};
```

Calls `getBufferStat` for each type, builds columns/rows arrays, renders `Table`. Formats numbers with `toFixed(3)`.

### `BufferGraph.tsx`

```ts
type BufferGraphProps = {
  data: BufferData;
};
```

Composes: Header, SeekableLabels, Bar (buffered, played, video, audio), Stats. Destructures `data` and passes to children. Contains layout classes (padding, font, background color, dividers, spacing).

### `utils.ts`

- `toPosition(time, seekable)` — time to CSS percentage string
- `toBarStyle(range, seekable)` — TimeRange to CSS left/width
- `getBufferStat(ranges, currentTime)` — ahead/behind distances

All pure functions, no side effects.

## CSS Changes

Move inline video styles from `index.html` to `app.css`:

```css
video {
  width: 100%;
  aspect-ratio: 16 / 9;
}
```

Remove the `<style>` block from `index.html`.
