import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser app. In development, `npm run dev:web` proxies the API to a running `refract` server.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { proxy: { "/api": "http://127.0.0.1:4100" } },
});
