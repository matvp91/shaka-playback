# Split selectStream Responsibilities

## Motivation

`selectStream` currently does two things: selects the best
stream for a media type, and determines what action is needed
relative to the current stream. These are separate concerns.
Splitting them makes `selectStream` a pure selection function
and moves action logic to the call site that actually needs it.

## Changes

### stream_select.ts

**`selectStream`** drops the `current` parameter and
`StreamAction` return. Returns a single `Stream`:

```ts
function selectStream(
  streams: Stream[],
  type: MediaType,
  preference?: StreamPreference,
): Stream
```

**`StreamAction` type** is removed from this file.

### stream_controller.ts

**`tryStart_`** — calls `selectStream(streams, type, preference)`
directly. No change in behavior (action was already unused here).

**`onStreamPreferenceChanged_`** — calls `selectStream`, then
inlines the old/new stream comparison to determine the action:

- Same stream (`isSameStream`) -> return early
- Different codec -> emit `BUFFER_CODECS` (changeType path)
- Same codec -> switch path (reset segments)

`isSameStream` needs to be exported from `stream_select.ts`
for use in `onStreamPreferenceChanged_`.
