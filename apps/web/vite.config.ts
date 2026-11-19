import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "./",
  resolve: {
    alias: {
      "@openlearnos/contracts": path.resolve(__dirname, "../../packages/contracts/src/index.ts"),
      "@openlearnos/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@openlearnos/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts"),
    },
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
