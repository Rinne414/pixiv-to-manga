import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
            },
            {
              name: 'canvas-vendor',
              test: /node_modules[\\/](konva|react-konva)[\\/]/,
              priority: 30,
            },
            {
              name: 'icons-vendor',
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 20,
            },
            {
              name: 'zip-vendor',
              test: /node_modules[\\/](jszip|lie|pako|setimmediate)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4174',
      '/assets': 'http://127.0.0.1:4174',
    },
  },
})
