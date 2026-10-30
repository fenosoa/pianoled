import { defineConfig } from 'vite';

// Client en lecture seule : écoute sur 0.0.0.0 pour s'ouvrir depuis une tablette / un téléphone du réseau local.
// Le lecteur d'accords (web_chords_karaoke, port 5180) reste le maître ; tout le calcul se fait dans le navigateur.
export default defineConfig({
  server: { port: 5190, host: true },
  preview: { port: 5191, host: true },
});
