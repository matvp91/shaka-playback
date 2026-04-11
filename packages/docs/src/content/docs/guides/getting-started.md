---
title: Getting Started
---

## Installation

```bash
npm install cmaf-lite
```

## Basic Usage

```ts
import { Player, Registry } from "cmaf-lite";
import { DashParser } from "cmaf-lite/dash";

// Register the DASH parser
Registry.add("manifest-parser", DashParser);

// Create a player and attach to a video element
const player = new Player();
player.attachMedia(document.querySelector("video"));
player.load("https://example.com/manifest.mpd");
```

## Concepts

- **Player** — central class that owns controllers, the
  event bus, and the public API.
- **Registry** — register format parsers (e.g., `DashParser`)
  before loading content.
- **Events** — all communication is event-driven. Listen on
  the player instance for manifest, buffer, and network events.
- **Configuration** — tune buffer lengths, gap tolerance, and
  more via `player.setConfig()`.
