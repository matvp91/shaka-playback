import { fetchManifest } from "./dash/dash_parser";

export class Player {
  async load(url: string) {
    const manifest = await fetchManifest(url);
    console.log(manifest);
  }
}
