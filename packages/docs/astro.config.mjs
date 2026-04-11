import { readFileSync } from "node:fs";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const referenceSidebar = JSON.parse(
  readFileSync(new URL("sidebar.json", import.meta.url), "utf-8"),
);

export default defineConfig({
  integrations: [
    starlight({
      title: "cmaf-lite",
      sidebar: [
        { label: "Guides", autogenerate: { directory: "guides" } },
        ...referenceSidebar,
      ],
    }),
  ],
});
