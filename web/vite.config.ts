/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// "./" base works on GitHub Pages (any repo path), when served by the
// backend, and in the single-file build used for previews.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "single" ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === "single" ? "dist-single" : "dist", emptyOutDir: true },
  server: { fs: { allow: [".."] } },
  test: { environment: "node" },
}));
