import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      "/colyseus": {
        target: "http://localhost:2567",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ""),
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/colyseus": {
        target: "http://localhost:2567",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ""),
      },
    },
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
