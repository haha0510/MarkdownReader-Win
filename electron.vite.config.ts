import { resolve } from 'path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
      chunkSizeWarningLimit: 4000
    }
  }
})
