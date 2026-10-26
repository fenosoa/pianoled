import { defineConfig } from 'vite';

// Écoute sur 0.0.0.0 pour ouvrir le lecteur depuis une tablette du réseau local.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
});
