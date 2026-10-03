import { resolve } from "node:path";
import { defineConfig } from "vite";

// Pages : la promenade (index.html), la galerie (galerie.html), la page About (about.html) et l'AR (ar.html)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        galerie: resolve(__dirname, "galerie.html"),
        about: resolve(__dirname, "about.html"),
        ar: resolve(__dirname, "ar.html"), // réalité augmentée sur un tableau
      },
    },
  },
});
