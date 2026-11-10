import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // framer-motion@10.18.0 package.json points to dist/es/index.mjs but it is missing in this install; use CJS entry.
      "framer-motion": path.resolve(__dirname, "./node_modules/framer-motion/dist/cjs/index.js"),
    },
  },
  optimizeDeps: {
    include: ["framer-motion"],
  },
  server: {
    proxy: {
      // Run `npm run dev:api` alongside Vite to serve the API handlers locally.
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
