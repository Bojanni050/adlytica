import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Informatie die onderin de sidebar het draaiende build-moment vastlegt, zodat
// herkenbaar is welke code de app echt uitvoert (stale dev-servers zenden anders
// onzichtbare oude builds door). Faalt git, dan degraderen we netjes naar "dev".
function buildInfo() {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    const date = new Date().toISOString().slice(0, 16).replace("T", " ");
    return { sha, date };
  } catch {
    return { sha: "dev", date: "" };
  }
}

const __BUILD__ = buildInfo();

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/node_modules/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  define: {
    __BUILD__: JSON.stringify(__BUILD__),
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
