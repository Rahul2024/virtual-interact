import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // three.js alone is ~700 KB minified; the budget is 15 MB first load.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          colyseus: ["@colyseus/sdk"],
        },
      },
    },
  },
});
