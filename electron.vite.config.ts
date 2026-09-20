import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { webpAssets } from './scripts/webpAssets'

// The version the menu prints. Read rather than imported: package.json is
// not in any tsconfig's program, and npm_package_version is unset outside npm.
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    define: {
      __APP_VERSION__: JSON.stringify(version)
    },
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    // Shipped PNG art is emitted as WebP, which is what keeps the packaged renderer small.
    plugins: [webpAssets('desktop'), react()]
  }
})
