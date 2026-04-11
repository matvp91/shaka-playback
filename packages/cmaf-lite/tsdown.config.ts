import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    main: "lib/index.ts",
    dash: "lib/dash/index.ts",
  },
  format: "esm",
  // TODO(matvp): Create priority in dev, we currently
  // do not clean due to demo relying on dist
  clean: false,
});
