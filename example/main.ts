import { Events, Player } from "../lib/index.ts";

const player = new Player();

player.setConfig({
  bufferGoal: 10,
});

const video = document.getElementById("videoElement") as HTMLVideoElement;

player.on(Events.MANIFEST_PARSED, ({ manifest }) => {
  console.log("Manifest parsed:", manifest);
});

player.on(Events.MEDIA_ATTACHED, () => {
  console.log("Media attached, MediaSource open");
});

player.on(Events.SEGMENT_LOADED, ({ track }) => {
  console.log(`Segment loaded: ${track.type}`);
});

player.attachMedia(video);

player.load(
  "https://d305rncpy6ne2q.cloudfront.net/v1/dash/94063eadf7d8c56e9e2edd84fdf897826a70d0df/SFP-MediaTailor-VOD-HLS-DASH/out/v1/b94f3611978f419985a18335bac9d9cb/ddb73bf548a44551a0059c346226445a/eaa5485198bf497284559efb8172425e/index.mpd?aws.sessionId=21567779-c8a8-4be9-9f18-d628dea03826",
);
