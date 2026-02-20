import path from "path"
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const litellmProxy = env.VITE_LITELLM_PROXY || ''

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        // Proxy API requests to the local tool-service
        // Use this when VITE_API_URL is set to /api
        '/api': {
          target: 'http://localhost:8078',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
        // Proxy direct LiteLLM requests to avoid CORS in development.
        // The client uses /litellm-direct/* which maps to VITE_LITELLM_PROXY/*.
        ...(litellmProxy
          ? {
              '/litellm-direct': {
                target: litellmProxy,
                changeOrigin: true,
                rewrite: (p) => p.replace(/^\/litellm-direct/, ''),
              },
            }
          : {}),
      },
    },
  }
})
