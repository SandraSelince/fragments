import { resolve } from "node:path";
import { defineConfig } from "vite";

// Pages : la promenade (index.html), la galerie des collages (galerie.html) et la page About (about.html)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        galerie: resolve(__dirname, "galerie.html"),
        about: resolve(__dirname, "about.html"),
      },
    },
  },
});
