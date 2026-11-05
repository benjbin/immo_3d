// Canopée — texworker.js
// Worker de textures (voir texpool.js) : exécute une tâche nommée de materials.js ou decortex.js et renvoie ses
// tableaux de pixels, transférés sans copie.
import { TEX_TASKS } from './materials.js';
import { DECOR_TASKS } from './decortex.js';

const TASKS = { ...TEX_TASKS, ...DECOR_TASKS };
// la prairie (traits Path2D anticrénelés) ne sort pas au bit près d'un OffscreenCanvas de worker : fil principal
delete TASKS['mat:meadow'];

// tampons des tableaux du résultat, y compris dans les mipmaps des cartes de feuillage
const buffersOf = (v, out = new Set()) => {
  if (ArrayBuffer.isView(v)) out.add(v.buffer);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) buffersOf(x, out);
  return out;
};

self.onmessage = ({ data: name }) => {
  let r = null;
  try { r = TASKS[name](); } catch (e) { r = null; }   // tâche ratée : calculée sur place par le fil principal
  self.postMessage({ name, r }, r ? [...buffersOf(r)] : []);
};
self.postMessage({ names: Object.keys(TASKS) });
