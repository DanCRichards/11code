/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import JavaScriptObfuscator from "javascript-obfuscator";

// Node's process, without pulling Node's types into the app's type check.
const readEnv = (k: string) => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];

/** Scramble the built JavaScript (production builds only; dev and tests are untouched).
 *  Kept to renaming and string hiding: control-flow flattening and dead-code injection
 *  slow things down, and self-defending code breaks under some browsers. The decoder
 *  itself is WebAssembly (assembly/selcall.ts), so it ships as a binary either way. */
function obfuscate(): Plugin {
  return {
    name: "obfuscate",
    apply: (_config, env) => env.command === "build" && readEnv("OBFUSCATE") !== "0", // OBFUSCATE=0 for a readable build
    enforce: "post",
    renderChunk(code) {
      const out = JavaScriptObfuscator.obfuscate(code, {
        target: "browser",
        compact: true,
        simplify: true,
        identifierNamesGenerator: "hexadecimal",
        renameGlobals: false,
        stringArray: true,
        stringArrayEncoding: ["base64"],
        stringArrayThreshold: 0.75,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        splitStrings: false,
        controlFlowFlattening: false,
        deadCodeInjection: false,
        selfDefending: false,
        transformObjectKeys: false,
        numbersToExpressions: false,
        sourceMap: false,
      });
      return { code: out.getObfuscatedCode(), map: null };
    },
  };
}

// "./" base works on GitHub Pages (any repo path), when served by the
// backend, and in the single-file build used for previews.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "single" ? [react(), obfuscate(), viteSingleFile()] : [react(), obfuscate()],
  build: { outDir: mode === "single" ? "dist-single" : "dist", emptyOutDir: true, sourcemap: false },
  server: { fs: { allow: [".."] } },
  test: { environment: "node" },
}));
