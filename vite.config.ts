import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/solar-system-sol/",
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
});
