import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/renderer',
    sourcemap: 'hidden',
    emptyOutDir: false, // don't wipe styles, index.html etc
    rollupOptions: {
      input: {
        renderer: resolve(__dirname, 'src/renderer/renderer.ts'),
        components: resolve(__dirname, 'src/renderer/components.ts'),
        vault: resolve(__dirname, 'src/renderer/vault.ts'),
        topology: resolve(__dirname, 'src/renderer/topology.ts'),
        axtree: resolve(__dirname, 'src/renderer/axtree.ts'),
        'watcher-analytics': resolve(__dirname, 'src/renderer/watcher-analytics.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: '[name][extname]',
      },
      // Externalize electron since it runs in renderer context
      external: ['electron'],
    },
    minify: 'esbuild',
  },
  resolve: {
    alias: {
      '@carbon-agent/shared-schemas': resolve(__dirname, '../packages/shared-schemas/src'),
      '@carbon-agent/local-store': resolve(__dirname, '../packages/local-store/src'),
      '@carbon-agent/core-runtime': resolve(__dirname, '../packages/core-runtime/src'),
      '@carbon-agent/cloak-bridge': resolve(__dirname, '../packages/cloak-bridge/src'),
      '@carbon-agent/ingestion': resolve(__dirname, '../packages/ingestion/src'),
    },
  },
});
