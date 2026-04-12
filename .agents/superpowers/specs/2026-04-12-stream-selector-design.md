# Stream Selector — Design Spec

## Goal

Add a stream selector UI to the demo app that displays available streams
grouped by type (video, audio) and allows changing stream preferences via
dropdowns.

## Utils Restructure

Move `cn()` from `src/utils.ts` to `src/utils/cn.ts`. Create
`src/utils/stream.ts` with pure helpers. Delete `src/utils.ts`.

### `src/utils/stream.ts`

- **`groupByType(streams: Stream[])`** — returns
  `{ video: VideoStream[], audio: AudioStream[] }`
- **`formatStream(stream: Stream)`** — human-readable label used as both
  display text and React key/select value.
  - Video: `"1280x720 · 2.1 MB/s · avc1"`
  - Audio: `"128 kB/s · mp4a"`
  - Uses `pretty-bytes` for bandwidth formatting (bytes/s → human-readable)
- **`formatBandwidth(bps: number)`** — wraps `pretty-bytes` with `/s` suffix

### `src/utils/cn.ts`

Existing `cn()` helper moved here. All imports updated.

## StreamSelector Component

**File:** `src/components/StreamSelector.tsx`

**Props:** `{ player: Player }`

**Behavior:**

- Reads `player.getStreams()` and groups by type using `groupByType()`
- Reads `player.getStreamPreference(type)` to determine selected value
- Renders two `<select>` elements — video (indigo) and audio (emerald),
  matching existing BufferGraph color scheme
- Selected value: `formatStream()` of the stream matching the current
  preference
- On change: finds the stream matching the selected label, calls
  `player.setStreamPreference(type, params, true)` with buffer flush
- Returns `null` if `getStreams()` throws (manifest not parsed yet)

**Stateless:** No React state. All state lives in the player, read each
render cycle (already 10ms interval from main.tsx).

## Integration

- Add `<StreamSelector player={player} />` in `App.tsx` above `<BufferGraph>`
- Remove hardcoded `player.setStreamPreference(VIDEO, { height: 720 })`
  from `main.tsx`

## Dependencies

- Add `pretty-bytes` to `packages/demo`

## Out of Scope

- Text/subtitle stream selection (no TEXT variant in Stream type yet)
- Abstract preference inputs (height/bandwidth fields)
