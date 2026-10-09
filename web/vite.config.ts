import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is overridable so the same build works on GitHub Pages (sub-path),
// Netlify/Vercel (root) and `vite preview`. See docs/DEPLOYMENT.md.
export default defineConfig({
  base: process.env.QBIND_BASE ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // React is split out so it stays cached across deploys.
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
