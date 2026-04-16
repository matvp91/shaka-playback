# Streams

A [`Stream`](/cmaf-lite/reference/cmaf-lite.stream/)
is a playback-ready view derived from the manifest. Where the
manifest models the source (switching sets, tracks, segments),
streams model what the player works with during playback.

## Building Streams

`buildStreams` walks the manifest once and projects each
track into a `Stream`. Codecs are normalized, streams are
deduplicated by type, codec, and resolution, and sorted by
bandwidth ascending — index 0 is the lowest quality. The
result is a `Map<MediaType, Stream[]>`.

## Hierarchy

Each stream carries a
[`StreamHierarchy`](/cmaf-lite/reference/cmaf-lite.streamhierarchy/)
back-reference to the manifest's own `SwitchingSet` and
`Track` objects. These are the exact manifest objects — not
copies — so reference equality can detect a switching-set
change (which drives MSE `changeType`).

## Selection

`selectStream` picks the best stream from a per-type list
given a
[`StreamPreference`](/cmaf-lite/reference/cmaf-lite.streampreference/).
All preference fields besides `type` are optional soft
targets. For video, selection minimizes distance across
resolution, bandwidth, and codec. For audio, it minimizes
distance across bandwidth and codec. A codec mismatch
incurs a large penalty to prefer codec-compatible streams.

Preferences are set via
[`Player.setStreamPreference()`](/cmaf-lite/reference/cmaf-lite.player/#setstreampreference).
