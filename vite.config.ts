import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/Trackless.ts",
      name: "Trackless",
      formats: ["es", "umd"],
      fileName: (format) => (format === "es" ? "trackless.es.js" : "trackless.umd.cjs"),
    },
    rollupOptions: {
      output: {
        exports: "named",
      },
    },
  },
});
