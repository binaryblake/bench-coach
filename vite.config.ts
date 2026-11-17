import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone'

  return {
    plugins: [react(), ...(standalone ? [viteSingleFile()] : [])],
    publicDir: standalone ? false : 'public',
    build: standalone
      ? {
          outDir: 'dist/standalone',
          assetsInlineLimit: 100_000_000,
          cssCodeSplit: false,
        }
      : undefined,
  }
})
