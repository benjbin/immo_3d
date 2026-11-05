// Canopée — texpool.js
// Textures procédurales calculées en parallèle. Dès l'ouverture de la maquette, un worker par cœur disponible
// exécute les tâches nommées de materials.js (TEX_TASKS) et decortex.js (DECOR_TASKS) pendant que le fil
// principal prépare le rendu ; les pixels sont déposés dans texcache.js. createMaterials et decorMaterials les
// reprennent, ou exécutent sur place une tâche manquante (workers indisponibles, erreur) : même code, mêmes
// pixels, rendu identique au bit près dans tous les cas.
import { provide } from './texcache.js';

// tâches les plus longues d'abord (chemin critique du pool)
const FIRST = ['mat:asphalt', 'mat:oakParquet', 'deco:qz', 'deco:trav', 'mat:tileFloor', 'deco:oak', 'mat:paver', 'deco:linen', 'deco:rug'];
const BOOT_TIMEOUT = 5000;

export function startTexturePool() {
  const workers = [], pending = new Set(), waiters = [];
  let queue = null, dead = false;
  const settle = () => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (dead || (queue && ![...pending].some((n) => n.startsWith(w.prefix)))) { waiters.splice(i, 1); w.resolve(); }
    }
  };
  const stop = () => { dead = true; pending.clear(); for (const w of workers) w.worker.terminate(); settle(); };
  const next = (w) => {
    if (dead) return;
    w.task = (queue && queue.shift()) || null;
    if (w.task) w.worker.postMessage(w.task);
    else { w.alive = false; w.worker.terminate(); }
  };
  let n = 1;
  try { n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)); } catch (e) { /* 1 worker */ }
  try {
    for (let i = 0; i < n; i++) {
      const worker = new Worker(new URL('./texworker.js', import.meta.url), { type: 'module' });
      const w = { worker, task: null, alive: true };
      worker.onmessage = ({ data }) => {
        if (data.names) {
          if (!queue) {
            clearTimeout(boot);
            const first = FIRST.filter((k) => data.names.includes(k));
            queue = [...first, ...data.names.filter((k) => !first.includes(k))];
            for (const k of queue) pending.add(k);
          }
          next(w);
          return;
        }
        if (data.r) provide(data.name, data.r);
        pending.delete(data.name);
        settle();
        next(w);
      };
      worker.onerror = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        w.alive = false;
        if (w.task) pending.delete(w.task);
        if (!queue || !workers.some((x) => x.alive)) stop(); else settle();
      };
      workers.push(w);
    }
  } catch (e) { stop(); }
  const boot = setTimeout(() => { if (!queue) stop(); }, BOOT_TIMEOUT);
  return {
    // promesse résolue quand plus aucune tâche du préfixe n'est en cours ('mat:', 'deco:')
    ready: (prefix = '') => new Promise((resolve) => { waiters.push({ prefix, resolve }); settle(); }),
  };
}
