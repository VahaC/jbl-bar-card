import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: {
    __CARD_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // One ES module with Lit bundled: HACS downloads every .js file of the
    // release, so a lazy chunk would 404, and the bar and HA are local-only.
    lib: {
      entry: "src/jbl-bar-card.ts",
      formats: ["es"],
      fileName: () => "jbl-bar-card.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2021",
    sourcemap: false,
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
  },
});
