import { execSync } from "node:child_process";
import relativeCiAgent from "@relative-ci/rollup-plugin";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    main: "lib/index.ts",
  },
  format: "esm",
  deps: {
    alwaysBundle: ["txml"],
  },
  // TODO(matvp): Create priority in dev, we currently
  // do not clean due to demo relying on dist.
  clean: false,
  plugins: [relativeCiAgent()],
  // Do not hash chunks, they mess with bundle analyzer.
  hash: false,
  onSuccess(config) {
    if (!config.watch) {
      // On full build, create API markdown files.
      execSync("api-extractor run --local --config api-generator/config.json");
      execSync(
        "api-documenter markdown -i api-generator/__generated__ -o api-generator/__generated__/markdown",
      );
    }
  },
});
