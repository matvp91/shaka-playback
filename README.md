# Barely a Player

What would a media player look like if we started from scratch in 2026?

I'm a [Shaka Player](https://github.com/shaka-project/shaka-player) maintainer. Shaka is built to be the player that works for everyone, and that's its strength. But I've spent years wondering what happens when you scope things down aggressively. Same learnings, way smaller scope. CMAF only. MSE/EME only. No legacy formats, no legacy key systems. That's it.

## The Experiment

[Shaka Player](https://github.com/shaka-project/shaka-player) and [hls.js](https://github.com/video-dev/hls.js) have over a decade of learnings baked in. Some great, some painful. The thing is, they have to support everything. Every container format, every key system, every browser quirk. That's the deal when you're the player everyone depends on.

But what if you don't have to?

CMAF changes things. One container format across DASH and HLS. The manifest is the only thing that's different. Same segments, same boxes, same codec strings. So much complexity just vanishes.

So that's what this is. One manifest model any protocol maps onto. One pipeline from manifest to media element. Controllers that only talk through events. Give it a URL and a `<video>` element. Done.

It's early. DASH VOD works. Buffering, seeking, gap recovery. ABR, live, HLS, DRM? Not yet. But the code stays small, the architecture stays clean, and adding stuff hasn't meant fighting what's already there. That's the whole point.

Built on the shoulders of [Shaka Player](https://github.com/shaka-project/shaka-player), [hls.js](https://github.com/video-dev/hls.js), and [Common Media Library](https://github.com/streaming-video-technology-alliance/common-media-library).
