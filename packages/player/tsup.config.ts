import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["lib/index.ts", "lib/dash/index.ts"],
  sourcemap: true,
  clean: true,
  format: "esm",
  dts: true,
});
