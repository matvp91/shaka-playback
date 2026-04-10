import { Events, Player, Registry, RegistryType } from "cmaf-lite";
import { DashParser } from "cmaf-lite/dash";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

Registry.add(RegistryType.MANIFEST_PARSER, DashParser);

const player = new Player();
Object.assign(window, { player });

player.setConfig({
  frontBufferLength: 30,
});

const video = document.getElementById("videoElement") as HTMLVideoElement;

player.on(Events.MANIFEST_PARSED, ({ manifest }) => {
  console.log("Manifest parsed:", manifest);
});

player.on(Events.MEDIA_ATTACHED, () => {
  console.log("Media attached, MediaSource open");
});

player.on(Events.BUFFER_APPENDED, ({ type }) => {
  console.log(`Buffer appended: ${type}`);
});

player.attachMedia(video);

player.load(
  "https://ue-video-vtmgo.dpgmedia.net/out/v1/df5b9943928b4c60ab9a86cef9a399c7/89f639bc23ee4456b296e61523441025/0f1c129bf59346c99c27dfa3e1f0dd18/index.mpd?aws.manifestfilter=subtitle_language%3Azzz%3Btrickplay_type%3Anone%3Baudio_codec%3AAACL",
  // "https://d305rncpy6ne2q.cloudfront.net/v1/dash/94063eadf7d8c56e9e2edd84fdf897826a70d0df/SFP-MediaTailor-VOD-HLS-DASH/out/v1/b94f3611978f419985a18335bac9d9cb/ddb73bf548a44551a0059c346226445a/eaa5485198bf497284559efb8172425e/index.mpd?aws.sessionId=21567779-c8a8-4be9-9f18-d628dea03826",
  // "https://livesim2.dashif.org/livesim2/segtimeline_1/testpic_2s/Manifest.mpd",
);

// biome-ignore lint/style/noNonNullAssertion: We definitely got this
const appElement = document.getElementById("app")!;
const root = createRoot(appElement);
setInterval(() => {
  root.render(<App player={player} />);
}, 10);
