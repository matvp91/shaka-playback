# Stream Selector Rework

Replace the current `StreamSelector` dropdown component with two new component groups: a read-only stream list and preference forms.

## Dependencies

- shadcn (init + relevant components)
- react-hook-form
- @hookform/resolvers
- zod

## Component Tree

```
src/components/
  stream-list/
    StreamList.tsx          — container, groups streams by type
    StreamGroup.tsx         — section for one media type (label + items)
    StreamItem.tsx          — single stream row with active indicator

  preferences/
    Preferences.tsx         — container, renders both forms
    VideoPreferenceForm.tsx — video form with zod schema
    AudioPreferenceForm.tsx — audio form with zod schema

  StreamSelector.tsx        — deleted
```

## StreamList

- Calls `player.getStreams()` and groups by type using existing `groupByType()`.
- Renders a `StreamGroup` for video and one for audio.
- Each `StreamGroup` maps streams to `StreamItem` components.
- `StreamItem` displays stream properties (resolution + bandwidth + codec for video, bandwidth + codec for audio) and indicates whether it is the active stream.
- Read-only — no click handlers.

## Preferences

- Contains `VideoPreferenceForm` and `AudioPreferenceForm`.
- Each form component owns its own zod schema.

### VideoPreferenceForm

Fields (all optional): `width` (number), `height` (number), `bandwidth` (number), `codec` (string).

On submit: calls `player.setStreamPreference({ type: MediaType.VIDEO, ...values }, true)`.

### AudioPreferenceForm

Fields (all optional): `bandwidth` (number), `codec` (string).

On submit: calls `player.setStreamPreference({ type: MediaType.AUDIO, ...values }, true)`.

### Form behavior

- Uses react-hook-form with zodResolver.
- Fields start empty (no pre-fill from active stream).
- Empty fields are omitted from the preference object.

## Data Access

- No `getData` extraction layer. Components call player methods directly
  (`player.getStreams()`, `player.getActiveStream()`, `player.getBuffered()`, etc.).
- Utility functions only for shared logic (e.g. `groupByType`).

## Layout

- `StreamList` and `Preferences` sit side by side above `BufferGraph`.
- `BufferGraph` remains unchanged below.

## Styling

- No visual styling — only structural CSS (flex layout, positioning).
- Existing components with non-structural styles should be cleaned up.
- Use shadcn components for form inputs and buttons.
