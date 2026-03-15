import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/main.ts'),
      },
    },
  },

  preload: {
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/preload.ts'),
      },
    },
  },

  renderer: {
    plugins: [react()],
  },
})