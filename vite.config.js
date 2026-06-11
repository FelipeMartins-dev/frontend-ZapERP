import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveDevBackendUrl } from './scripts/resolveDevBackendUrl.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devBackend = resolveDevBackendUrl(env)

  if (mode === 'development') {
    console.log(`[vite] Proxy /uploads e /media → ${devBackend}`)
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/uploads': {
          target: devBackend,
          changeOrigin: true,
        },
        '/media': {
          target: devBackend,
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
  }
})
