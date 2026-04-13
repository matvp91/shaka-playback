import relativeCiAgent from "@relative-ci/rollup-plugin";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    main: "lib/index.ts",
    dash: "lib/dash/index.ts",
  },
  format: "esm",
  noExternal: ["txml"],
  // TODO(matvp): Create priority in dev, we currently
  // do not clean due to demo relying on dist.
  clean: false,
  plugins: [relativeCiAgent()],
  // Do not hash chunks, they mess with bundle analyzer.
  hash: false,
});
