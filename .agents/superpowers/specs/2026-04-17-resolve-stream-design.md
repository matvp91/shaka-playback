# Resolve Stream

## Problem

`StreamUtils.findBestSuitableStream` mixes two concerns in one pass: matching
user preferences against streams (content selection) and picking a tier within
a match set by video height (quality selection). The shape is awkward — it
filters a candidate set, then runs a separate `pickWithinTier` step that only
applies to video, and the distance-based height match lives alongside strict
codec equality.

Height is also a poor fit for a content preference. It expresses "how much
bandwidth" rather than "what I want to watch", which is ABR's responsibility.
Keeping it on `VideoPreference` couples preference matching to quality
selection and forces every preference match to do a post-filter tier pick.

Finally, stream selection at `tryStart_` is inlined logic. As preference
resolution is needed in more places (runtime preference change, manifest
refresh, period transitions, codec fallback), that inlining has to be either
duplicated or lifted. This spec lifts it once.

## Design

### 1. Types (`lib/types/media.ts`)

Remove `height` from `VideoPreference`. All preference fields become
strict-equality matchers:

- `VideoPreference`: `{ type: VIDEO, codec? }`
- `AudioPreference`: `{ type: AUDIO, codec?, language?, channels? }`
- `SubtitlePreference`: `{ type: SUBTITLE, codec?, language? }`

Quality tier selection is out of scope for preferences; ABR owns that.

### 2. Stream utilities (`lib/utils/stream_utils.ts`)

#### Rename and reshape `findBestSuitableStream` → `findStreamsMatchingPreferences`

```ts
export function findStreamsMatchingPreferences<T extends MediaType>(
  type: T,
  streams: Stream<T>[],
  preferences: Preference[],
): Stream<T>[] | null;
```

Behaviour:

- Iterates `preferences` in order; order expresses priority.
- Skips preferences where `preference.type !== type`.
- For the first type-matching preference that yields non-empty matches,
  returns the full match set.
- Returns `null` when no preference matched any stream.
- Match predicate: every defined field on the preference equals the
  corresponding field on the stream (strict equality, no distance, no scoring).

Returning the set — rather than a single stream — lets the caller apply
bandwidth-anchored selection without baking ABR or bandwidth logic into the
preference layer.

#### Delete `pickWithinTier`

No longer needed once `height` is gone from `VideoPreference`.

#### Add `pickClosestByBandwidth`

```ts
export function pickClosestByBandwidth(
  matches: VideoStream[],
  activeStream: VideoStream,
): VideoStream;
```

Behaviour:

- Returns the stream in `matches` with smallest
  `|stream.bandwidth - activeStream.bandwidth|`.
- Ties are broken by whichever stream comes first in `matches` (stable).

Video-only. Audio and subtitle ladders do not warrant this treatment.

### 3. Stream controller (`lib/media/stream_controller.ts`)

#### Add `resolveStream_`

Single private method that combines preferences, active stream, and available
streams into one chosen stream:

```ts
private resolveStream_<T extends MediaType>(
  type: T,
  streams: Stream<T>[],
): Stream<T> {
  const { preferences } = this.player_.getConfig();
  const matches = StreamUtils.findStreamsMatchingPreferences(
    type,
    streams,
    preferences,
  );
  const activeStream = this.streams_.get(type);

  if (matches) {
    if (type === MediaType.VIDEO && activeStream) {
      return StreamUtils.pickClosestByBandwidth(matches, activeStream);
    }
    return matches[0]!;
  }
  return activeStream ?? streams[0]!;
}
```

Resolution rules in plain English:

1. If preferences match: pick from the match set.
   - For video with an existing active stream, anchor on the active stream's
     bandwidth via `pickClosestByBandwidth`.
   - Otherwise (cold start or non-video), return the first match (lowest
     bandwidth, since `buildStreams` sorts ascending).
2. If preferences do not match any stream: keep the active stream if one
   exists; else fall back to `streams[0]` (lowest bandwidth).

#### Replace inline selection in `tryStart_`

Current block at `stream_controller.ts:165-173`:

```ts
const { preferences } = this.player_.getConfig();
for (const [type, streams] of this.streamsMap_) {
  const stream =
    StreamUtils.findBestSuitableStream(type, streams, preferences) ??
    this.streams_.get(type) ??
    streams[0];
  asserts.assertExists(stream, "Missing initial stream");
  this.streams_.set(type, stream);
  log.info("Initial", type, stream);
}
```

Becomes:

```ts
for (const [type, streams] of this.streamsMap_) {
  const stream = this.resolveStream_(type, streams);
  this.streams_.set(type, stream);
  log.info("Initial", type, stream);
}
```

### 4. Tests

Update `packages/cmaf-lite/test/utils/stream_utils.test.ts` to cover:

- `findStreamsMatchingPreferences`:
  - First type-matching preference with non-empty matches wins; later
    preferences are not consulted.
  - Preferences with a non-matching `type` are skipped.
  - Strict equality on every defined field (codec, language, channels).
  - Undefined preference fields do not constrain.
  - Returns `null` when no preference matches any stream.
- `pickClosestByBandwidth`:
  - Picks the match with smallest bandwidth distance from `activeStream`.
  - Ties resolve to whichever comes first in `matches`.

No stream controller tests are added in this change. `packages/cmaf-lite/test/media/`
does not yet have a `stream_controller.test.ts` or the MSE mock infrastructure the
testing guidelines call for; building that harness is out of scope for this
refactor. `resolveStream_` is small, self-contained, and exercised end-to-end by
the demo app. A dedicated stream controller test file is a reasonable follow-up.

## Scope

In scope:

- Library type change (remove `height` from `VideoPreference`).
- `findStreamsMatchingPreferences` + `pickClosestByBandwidth` in `stream_utils`.
- `resolveStream_` in `StreamController`, wired only from `tryStart_`.
- Tests covering the above.

Out of scope:

- Calling `resolveStream_` from runtime preference changes, manifest refresh,
  DASH period transitions, or codec fallback. The signature supports these
  cases; wiring is future work.
- Demo `VideoPreferenceForm`'s `height` input. The form's `onSubmit` is already
  a stub (`TODO(matvp): setStreamPreference is gone`), so the library type
  change does not break any wired demo behaviour. Cleaning up the unwired form
  is unrelated churn.
- Bandwidth-driven initial quality selection via the ABR estimator. The active
  stream's bandwidth is the sole anchor for now.
