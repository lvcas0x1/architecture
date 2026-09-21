import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * An IIFE build meant to be embedded in a single HTML file.
 *
 * Everything including React is bundled into one file, so the exported HTML
 * depends on no external CDN and works on an internal network or as an attachment.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./src/main.tsx", import.meta.url)),
      name: "ArchitectureViewer",
      formats: ["iife"],
      fileName: () => "viewer.js",
      cssFileName: "viewer",
    },
  },
});
