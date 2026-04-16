---
title: Getting Started
---

## Installation

```bash
npm install cmaf-lite
```

## Basic Usage

```ts
import { Player } from "cmaf-lite";

// Create a player and attach to a video element
const player = new Player();
player.attachMedia(document.querySelector("video"));
player.load("https://example.com/manifest.mpd");
```

## Concepts

- **Player** — central class that owns controllers, the
  event bus, and the public API.
- **Events** — all communication is event-driven. Listen on
  the player instance for manifest, buffer, and network events.
- **Configuration** — tune buffer lengths, gap tolerance, and
  more via `player.setConfig()`.
