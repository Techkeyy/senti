import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The camera reader runs in a utilityProcess, so it is a second main-process entry.
        input: { index: resolve('src/main/index.ts'), 'sensing-worker': resolve('src/main/sensing-worker.ts') }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
