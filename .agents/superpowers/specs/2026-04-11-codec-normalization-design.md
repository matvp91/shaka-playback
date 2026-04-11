# Codec Normalization

## Problem

Codec strings flow through cmaf-lite as raw RFC 6381 values
(e.g., `avc3.42c01e`, `mp4a.40.2`). The Stream type — which is
the public-facing API — exposes these raw strings. Consumers
must understand codec string internals to compare or select
streams. There is no base-codec concept for simplified
comparison, and no structured parsing of codec components.

## Design

### Two levels of codec representation

- **Full codec** (`SwitchingSet.codec`) — the raw RFC 6381
  string from the manifest, unchanged. Used internally and
  passed to MSE via `getContentType()`.
- **Normalized codec** (`Stream.codec`) — a canonical name
  representing the codec family. Used for comparison,
  selection, and the public API.

### Supported codecs

| Normalized | Full codec variants |
|------------|-------------------|
| `avc`      | `avc1.*`, `avc3.*` |
| `hevc`     | `hev1.*`, `hvc1.*` |
| `av1`      | `av01.*` |
| `aac`      | `mp4a.66`, `mp4a.67`, `mp4a.68`, `mp4a.40.2`, `mp4a.40.02`, `mp4a.40.5`, `mp4a.40.05`, `mp4a.40.29`, `mp4a.40.42` |
| `ac-3`     | `ac-3` |
| `ec-3`     | `ec-3` |

CMAF notes:
- CMAF mandates `avc3` for H.264 and `hev1` for H.265
  (in-band parameter sets for fragment independence).
- AC-3 and EC-3 use dedicated ISOBMFF sample entry boxes,
  not `mp4a` wrappers. The `mp4a.a5`/`mp4a.a6` forms are
  not CMAF-compliant.
- AAC is always signaled as `mp4a.40.x` — bare `aac` does
  not exist as a fourCC.

### New functions in codec_utils.ts

**`getCodecBase(codec)`** — extracts the base component
before the first dot. Returns the full string if no dot.

**`getCodecProfile(codec)`** — extracts the profile component
after the first dot. Returns `null` if no dot.

**`getNormalizedCodec(codec)`** — returns the canonical codec
name. Uses `switch (true)` with `base` and `profile` extracted
at the top. Explicit case matching per Shaka Player's pattern.
Throws on unsupported codecs. The `mp4a` branch inspects the
profile to distinguish AAC from other MPEG-4 audio codecs.

### Changes to existing code

**`getStreams()` in stream_utils.ts** — calls
`getNormalizedCodec(ss.codec)` when building Stream objects.
Single normalization point.

**`resolveHierarchy()` in stream_utils.ts** — compares
`getNormalizedCodec(switchingSet.codec)` against
`stream.codec` to bridge between full and normalized forms.

**`BUFFER_CODECS` event in stream_controller.ts** — sends
`switchingSet.codec` (full string) instead of `stream.codec`
(normalized) at both emit sites. BufferController needs the
full string for MSE.

**`getContentType()` in codec_utils.ts** — no change. Receives
the full codec string from the event. Browser compatibility
patching deferred to a future iteration.

### Unchanged

- `isSameStream()` — both sides normalized, works as-is.
- `matchVideoPreference()` / `matchAudioPreference()` —
  preferences use normalized names, works as-is.
- `BufferCodecsEvent` type — still carries full codec string.
- `getSwitchingSetId()` — uses full codec from SwitchingSet.
