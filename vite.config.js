import { defineConfig } from "vite";

// Config pensada para Tauri: no limpiar la consola y puerto fijo.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
  },
});
