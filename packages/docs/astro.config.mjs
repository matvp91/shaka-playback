import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import referenceSidebar from "./sidebar-reference.json" with { type: "json" };

export default defineConfig({
  site: "https://matvp91.github.io",
  base: "/cmaf-lite/",
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
