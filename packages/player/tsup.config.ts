import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "lib/index.ts",
    dash: "lib/dash/index.ts",
  },
  sourcemap: true,
  clean: true,
  format: "esm",
  dts: true,
});
