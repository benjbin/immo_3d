// Effets « cinéma » ajoutés à la maquette depuis l'expérience (module chargé DANS l'iframe, via son importmap).
// Profondeur de champ (depuis la profondeur du G-buffer de la GTAO, aucun rendu supplémentaire),
// aberration chromatique, grain et vignettage très discrets. Rien n'est modifié dans canopee/3d/.
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const V = window.__viewer;
const gtao = V.composer.passes.find((p) => p.depthTexture);

const CinemaShader = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, near: { value: 0.2 }, far: { value: 1600 },
    focus: { value: 12 }, range: { value: 8 }, maxBlur: { value: 0 }, res: { value: new THREE.Vector2(1, 1) },
    ca: { value: 0.0012 }, grain: { value: 0.018 }, vig: { value: 0.22 }, time: { value: 0 }, fg: { value: 1.6 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth; uniform float near, far, focus, range, maxBlur, ca, grain, vig, time, fg; uniform vec2 res; varying vec2 vUv;
    float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
    float coc(vec2 uv){ float d = texture2D(tDepth, uv).x; if (d >= 1.0) d = 0.99999; float z = lin(d); float k = (z - focus) / max(range, 0.01); k = k < 0.0 ? -k * fg : k; return clamp(k, 0.0, 1.0) * maxBlur; }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 px = 1.0 / res;
      vec2 dc = vUv - 0.5;
      // aberration chromatique radiale (très faible)
      vec2 off = dc * ca;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float r = maxBlur > 0.01 ? coc(vUv) : 0.0;
      if (r > 0.6) {
        // disque de 16 échantillons (spirale dorée), pondéré par le flou de chaque échantillon pour limiter les halos
        vec3 acc = c; float wsum = 1.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i) + 0.5; float a = fi * 2.39996; float rr = sqrt(fi / 16.0) * r;
          vec2 uv = vUv + vec2(cos(a), sin(a)) * rr * px;
          float w = clamp(coc(uv) / max(r, 0.001), 0.15, 1.0);
          acc += texture2D(tDiffuse, uv).rgb * w; wsum += w;
        }
        c = acc / wsum;
      }
      // vignettage doux et grain fin
      float v = smoothstep(0.95, 0.25, length(dc * vec2(res.x / res.y, 1.0)));
      c *= mix(1.0 - vig, 1.0, v);
      c += (hash(vUv * res + time) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};
const pass = new ShaderPass(CinemaShader);
pass.uniforms.tDepth.value = gtao ? gtao.depthTexture : null;
V.composer.addPass(pass);
const size = new THREE.Vector2();

window.__xpfx = {
  set(o = {}) {
    const u = pass.uniforms;
    V.renderer.getDrawingBufferSize(size); u.res.value.copy(size);
    u.near.value = V.camera.near; u.far.value = V.camera.far;
    const dofOk = !!(gtao && gtao.enabled) && V.state.quality !== 'low';
    u.maxBlur.value = dofOk ? (o.blur || 0) * (size.y / 1000) : 0;
    if (o.focus != null) u.focus.value = o.focus;
    if (o.range != null) u.range.value = o.range;
    u.time.value = (u.time.value + 1.618) % 100;
    if (o.grain != null) u.grain.value = o.grain;
  },
};
