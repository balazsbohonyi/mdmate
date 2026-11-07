import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const devHost = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: devHost ?? false,
    ...(devHost ? { hmr: { protocol: 'ws', host: devHost, port: 1421 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
