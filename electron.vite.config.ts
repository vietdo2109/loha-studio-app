import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const appName = process.env.BUILD_PRODUCT_NAME || 'Loha Studio'
const iconFile = process.env.BUILD_ICON || 'icon.ico'

export default defineConfig({
  main: {
    define: {
      '__APP_DISPLAY_NAME__': JSON.stringify(appName),
      '__BUILD_ICON_FILE__': JSON.stringify(iconFile),
    },
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
    define: {
      '__APP_NAME__': JSON.stringify(appName),
    },
    plugins: [react()],
  },
})