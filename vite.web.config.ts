import { readFileSync } from 'fs'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { webpAssets } from './scripts/webpAssets'

// The version the menu prints. Read rather than imported: package.json is
// not in any tsconfig's program, and npm_package_version is unset outside npm.
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

/** The browser build: `src/web` wires the bridge, then hands over to the renderer. */
export default defineConfig({
  root: resolve('src/web'),
  // itch serves a game from a folder it picks, so every URL has to be relative.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  plugins: [webpAssets('web'), react()],
  server: {
    fs: {
      // The renderer, the shared tree and `assets` all sit above the root.
      allow: [resolve('.')]
    }
  },
  build: {
    outDir: resolve('release/web'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Every asset is a file of its own: an inlined data URI would be re-encoded
    // into the bundle and counted twice against the size cap.
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})
