# Manifest Model

Format-agnostic internal representation. Any parser (DASH
today) outputs this structure. Type definitions live in
[lib/types/manifest.ts](../lib/types/manifest.ts).

## Hierarchy

```
Manifest
  └── Presentation[]
        └── SelectionSet[]
              └── SwitchingSet[]
                    └── Track[]
                          └── Segment[]
```

- **Presentation** — time-bounded content period.
- **SelectionSet** — groups by media type, maps 1:1 to an
  MSE SourceBuffer.
- **SwitchingSet** — tracks with same codec, seamlessly
  switchable (CMAF switching set).
- **Track** — single quality level. Discriminated union on
  `MediaType` — video carries `width`/`height`, audio has
  no additional properties yet.
- **Segment** — addressable media chunk with timing on the
  presentation timeline.

## Stable References

Manifest objects are mutable with stable references.
Controllers hold direct references and use them as map keys.
For live, manifest refreshes will update objects in place
rather than replacing the tree.

## DASH Mapping

| DASH | Internal |
|------|----------|
| MPD | Manifest |
| Period | Presentation |
| AdaptationSet (grouped) | SelectionSet |
| AdaptationSet (within group) | SwitchingSet |
| Representation | Track |
| SegmentTemplate + Timeline | Segment[] + InitSegment |

Segment times are resolved to the presentation timeline at
parse time. URLs are fully resolved. Presentation end uses
the DASH fallback chain: `@duration` → next `@start` →
`@mediaPresentationDuration` → last segment end.
