import type { Clock } from './clock';
import type { KaraokeRenderer } from './KaraokeRenderer';

/** Boucle requestAnimationFrame : lit l'horloge et pilote le renderer. Retourne la fonction d'arrêt. */
export function runRenderLoop(renderer: KaraokeRenderer, clock: Clock): () => void {
  let raf = 0;
  const tick = () => {
    renderer.render(clock.now());
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
