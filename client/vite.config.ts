import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: 'es',
    plugins: () => [
      // Include the same plugins for workers if needed
    ],
    rollupOptions: {
      output: {
        entryFileNames: 'assets/worker-[name]-[hash].js',
      }
    }
  },
  // Ensure TypeScript compiles workers
  optimizeDeps: {
    exclude: ['comlink']
  }
})
