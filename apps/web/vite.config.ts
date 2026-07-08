import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", routeFileIgnorePattern: "\\.test\\." }),
    react(),
  ],
});
