// Canopée — texcache.js
// Résultats des tâches de textures calculées par les workers (texpool.js). Chaque résultat est repris une fois
// par createMaterials / decorMaterials (take) ; sans résultat (workers indisponibles, tâche pas encore faite),
// la tâche est exécutée sur place : même code, mêmes pixels.
const READY = new Map();

export function provide(name, result) { READY.set(name, result); }

export function take(name, task) {
  const r = READY.get(name);
  if (r) { READY.delete(name); return r; }
  return task();
}
