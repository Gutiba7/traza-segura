import { defineConfig } from "vite";

// La app se publica en https://gutiba7.github.io/traza-segura/, por eso la ruta base.
export default defineConfig({
  base: "/traza-segura/",
  // MapLibre ocupa cerca de 1 MB (≈ 280 KB comprimido); es normal para un mapa interactivo.
  build: { chunkSizeWarningLimit: 1200 },
});
