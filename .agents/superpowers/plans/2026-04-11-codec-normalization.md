# Codec Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce structured codec parsing and normalization so Stream exposes canonical codec names while SwitchingSet retains the full RFC 6381 string for MSE.

**Architecture:** Three new functions in `codec_utils.ts` (`getCodecBase`, `getCodecProfile`, `getNormalizedCodec`) provide the parsing layer. `getStreams()` normalizes at stream creation. `resolveHierarchy()` bridges back via `getNormalizedCodec()`. `BUFFER_CODECS` event sends the full codec from SwitchingSet.

**Tech Stack:** TypeScript, no new dependencies.

---

### Task 1: Add codec parsing and normalization functions

**Files:**
- Modify: `packages/cmaf-lite/lib/utils/codec_utils.ts`

- [ ] **Step 1: Add `getCodecBase` and `getCodecProfile`**

```ts
/**
 * Extract the base component from a codec string.
 * Returns the full string when no profile is present.
 */
export function getCodecBase(codec: string): string {
  const idx = codec.indexOf(".");
  return idx === -1 ? codec : codec.substring(0, idx);
}

/**
 * Extract the profile component from a codec string.
 * Returns null when no profile is present.
 */
export function getCodecProfile(codec: string): string | null {
  const idx = codec.indexOf(".");
  return idx === -1 ? null : codec.substring(idx + 1);
}
```

- [ ] **Step 2: Add `getNormalizedCodec`**

```ts
/**
 * Normalize a full RFC 6381 codec string to a
 * canonical codec family name. Modeled after Shaka
 * Player's MimeUtils.getNormalizedCodec.
 */
export function getNormalizedCodec(codec: string): string {
  const base = getCodecBase(codec).toLowerCase();
  const profile = getCodecProfile(codec)?.toLowerCase();

  switch (true) {
    // AAC
    case base === "mp4a" && profile === "66":
    case base === "mp4a" && profile === "67":
    case base === "mp4a" && profile === "68":
    case base === "mp4a" && profile === "40.2":
    case base === "mp4a" && profile === "40.02":
    case base === "mp4a" && profile === "40.5":
    case base === "mp4a" && profile === "40.05":
    case base === "mp4a" && profile === "40.29":
    case base === "mp4a" && profile === "40.42":
      return "aac";
    // AC-3
    case base === "ac-3":
      return "ac-3";
    // EC-3
    case base === "ec-3":
      return "ec-3";
    // H.264
    case base === "avc1":
    case base === "avc3":
      return "avc";
    // H.265
    case base === "hev1":
    case base === "hvc1":
      return "hevc";
    // AV1
    case base === "av01":
      return "av1";
    default:
      throw new Error(`Unsupported codec: ${codec}`);
  }
}
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/utils/codec_utils.ts
git commit -m "feat: add codec parsing and normalization functions"
```

---

### Task 2: Normalize codec in stream creation

**Files:**
- Modify: `packages/cmaf-lite/lib/utils/stream_utils.ts`

- [ ] **Step 1: Import CodecUtils and normalize in `getStreams()`**

Add the import at the top of the file:

```ts
import * as CodecUtils from "./codec_utils";
```

Change the two places where `ss.codec` is assigned to Stream objects (lines 17 and 21):

```ts
// Line 17, inside the video branch:
codec: CodecUtils.getNormalizedCodec(ss.codec),

// Line 21, inside the audio branch:
{ type: track.type, codec: CodecUtils.getNormalizedCodec(ss.codec) };
```

- [ ] **Step 2: Update `resolveHierarchy()` to bridge normalized ↔ full**

Change the comparison at line 119 from:

```ts
switchingSet.codec !== stream.codec
```

to:

```ts
CodecUtils.getNormalizedCodec(switchingSet.codec) !== stream.codec
```

- [ ] **Step 3: Run type check**

Run: `pnpm tsc`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/utils/stream_utils.ts
git commit -m "feat: normalize codec at stream creation"
```

---

### Task 3: Send full codec in BUFFER_CODECS event

**Files:**
- Modify: `packages/cmaf-lite/lib/media/stream_controller.ts`

- [ ] **Step 1: Update `tryStart_()` emit**

Change the emit at lines 223-227 from `stream.codec` to `switchingSet.codec`:

```ts
this.player_.emit(Events.BUFFER_CODECS, {
  type,
  codec: switchingSet.codec,
  duration: this.manifest_.duration,
});
```

- [ ] **Step 2: Update `onStreamPreferenceChanged_` emit**

Change the emit at lines 151-155 from `stream.codec` to `switchingSet.codec`.
The variable `switchingSet` is already in scope (assigned at line 145):

```ts
this.player_.emit(Events.BUFFER_CODECS, {
  type: mediaState.type,
  codec: switchingSet.codec,
  duration: this.manifest_.duration,
});
```

- [ ] **Step 3: Run type check and build**

Run: `pnpm tsc && pnpm build`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cmaf-lite/lib/media/stream_controller.ts
git commit -m "feat: send full codec string in BUFFER_CODECS event"
```

---

### Task 4: Verify and format

- [ ] **Step 1: Run format**

Run: `pnpm format`
Expected: Clean or auto-fixed.

- [ ] **Step 2: Run full build**

Run: `pnpm build`
Expected: No errors.

- [ ] **Step 3: Commit any formatting changes**

```bash
git add -A
git commit -m "style: format codec normalization changes"
```

Skip this commit if `pnpm format` made no changes.
