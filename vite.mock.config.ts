import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

/**
 * Alleen voor ontwerpwerk: start de app in een gewone browser met
 * `npm run dev:mock`, waarbij de Tauri-brug is vervangen door
 * `dev/mock-tauri.ts`. De gewone `npm run dev` en de Tauri-build zijn hier
 * niet door geraakt.
 */
export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: {
        "@tauri-apps/api/core": new URL("./dev/mock-tauri.ts", import.meta.url).pathname,
      },
    },
    server: { port: 5199, strictPort: true },
  })
);
