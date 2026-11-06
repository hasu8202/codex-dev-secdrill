/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// dist/index.html をダブルクリックで開いても動くようにする(サーバー・通信は不要)。
// file:// では type="module" のスクリプトがブラウザに拒否されるので、単一の通常スクリプト(IIFE)として出力する。
function classicScript(): Plugin {
  return {
    name: 'secdrill-classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin/g, '<script defer')
        .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"')
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), classicScript()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife' } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
