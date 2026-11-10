import { defineConfig } from "vite";
import { cpSync, existsSync, createReadStream, statSync } from "node:fs";
import { resolve, join, normalize } from "node:path";

/* Recursos de pdf.js que se cargan en tiempo de ejecucion: fuentes estandar
   (Times, Helvetica... cuando el PDF no las incrusta), cmaps de CJK y los
   decodificadores wasm de JPX/JBIG2 (PDFs escaneados). Se sirven desde
   /pdfjs/ para que la app funcione sin internet. */
const PDFJS_ASSETS = ["standard_fonts", "cmaps", "wasm"];
const pdfjsRoot = resolve("node_modules/pdfjs-dist");

function pdfjsAssets() {
  return {
    name: "bookiin-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const file = normalize(join(pdfjsRoot, decodeURIComponent(req.url.split("?")[0])));
        if (!file.startsWith(pdfjsRoot) || !existsSync(file) || !statSync(file).isFile()) return next();
        if (file.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      for (const dir of PDFJS_ASSETS) {
        cpSync(join(pdfjsRoot, dir), join(options.dir, "pdfjs", dir), { recursive: true });
      }
    },
  };
}

// Config pensada para Tauri: no limpiar la consola y puerto fijo.
export default defineConfig({
  clearScreen: false,
  plugins: [pdfjsAssets()],
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
