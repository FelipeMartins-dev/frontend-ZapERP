import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const LOCAL_BACKEND = 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/uploads': {
        target: LOCAL_BACKEND,
        changeOrigin: true,
      },
    },
  },
  build: {
    // Source maps pesam build + upload (Vercel). Ative só quando precisar (ex.: Sentry): VITE_SOURCEMAP=1
    sourcemap: process.env.VITE_SOURCEMAP === "1",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[/\\]node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) return "vendor-react";
          if (/[/\\]node_modules[/\\]react-router/.test(id)) return "vendor-router";
          if (/[/\\]node_modules[/\\]axios[/\\]/.test(id)) return "vendor-axios";
          return undefined;
        },
      },
    },
  },
})
