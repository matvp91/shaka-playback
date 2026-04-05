import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: "lib/index.ts",
      formats: ["es"],
      fileName: "main",
    },
  },
  plugins: [dts({ rollupTypes: true })],
});
