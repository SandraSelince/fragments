import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * Effet PIXEL FLOW (glitch de transition d'Aurore ocre, d'après la vidéo de référence) :
 *  - les pixels sont déplacés ligne par ligne (bandes horizontales qui glissent) ;
 *  - l'image précédente est "charriée" par un champ de courants (bruit tourbillonnant) :
 *    les couleurs s'étirent en coups de pinceau, comme une peinture qui coule ;
 *  - des points lumineux tournoient et laissent des traînées blanches en pointillés.
 *
 * Technique : une image "mémoire" (rendu précédent) est conservée d'une frame à
 * l'autre (ping-pong de deux render targets) et relue en suivant le champ de courants.
 *
 * Réglages : voir FLOW ci-dessous.
 */
export const FLOW = {
  rows: 3, // hauteur des lignes déplacées, en pixels
  rowShift: 110, // décalage horizontal maximum des lignes, en pixels
  flow: 3.5, // vitesse du courant qui charrie l'image (pixels par frame)
  swirl: 3.5, // taille des tourbillons (plus grand = plus petits tourbillons)
  warp: 16, // torsion de l'image actuelle le long des courants, en pixels
  persist: 0.915, // mémoire de l'image (0 = aucune traînée, 0.97 = très long)
  sparks: 0, // points lumineux ajoutés (0 = aucun : seule l'image se déforme)
  sparkSize: 1.8, // taille des points lumineux, en pixels
  trail: 0.975, // durée des traînées lumineuses (proche de 1 = très longues)
};

const shader = {
  uniforms: {
    tDiffuse: { value: null },
    tPrev: { value: null },
    uAmount: { value: 0 },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uRows: { value: FLOW.rows },
    uRowShift: { value: FLOW.rowShift },
    uFlow: { value: FLOW.flow },
    uSwirl: { value: FLOW.swirl },
    uWarp: { value: FLOW.warp },
    uPersist: { value: FLOW.persist },
    uSparks: { value: FLOW.sparks },
    uSparkSize: { value: FLOW.sparkSize },
    uTrail: { value: FLOW.trail },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tPrev;
    uniform float uAmount, uTime, uSeed, uRows, uRowShift, uFlow, uSwirl, uWarp, uPersist, uSparks, uSparkSize, uTrail;
    uniform vec2 uRes;
    varying vec2 vUv;

    float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
    float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += vnoise(p) * a; p *= 2.07; a *= 0.5; } return s; }

    // champ de courants sans divergence (curl du bruit) : des tourbillons qui ne "s'aspirent" pas
    vec2 curl(vec2 p) {
      float e = 0.02;
      float dx = fbm(p + vec2(e, 0.0)) - fbm(p - vec2(e, 0.0));
      float dy = fbm(p + vec2(0.0, e)) - fbm(p - vec2(0.0, e));
      return vec2(dy, -dx) / (2.0 * e);
    }

    void main() {
      float A = clamp(uAmount, 0.0, 1.0);
      vec2 px = vUv * uRes;
      float aspect = uRes.x / uRes.y;

      // 1. déplacement ligne par ligne de l'image actuelle
      float row = floor(px.y / uRows);
      float band = smoothstep(0.35, 0.65, vnoise(vec2(row * 0.035, uTime * 1.3 + uSeed)));
      float jit = (vnoise(vec2(row * 0.6, uTime * 6.0 + uSeed)) - 0.5) * 2.0;
      float shift = jit * band * uRowShift * A / uRes.x;
      vec2 q = vec2(vUv.x * aspect, vUv.y) * uSwirl + vec2(uSeed, uSeed * 0.37) + vec2(0.0, uTime * 0.05);
      vec2 f = curl(q);
      vec2 warpUv = vUv + f * uWarp * A / uRes;
      vec4 cur = texture2D(tDiffuse, vec2(fract(warpUv.x + shift), clamp(warpUv.y, 0.0, 1.0)));

      // 2. image précédente charriée par le courant
      vec2 prevUv = vUv - f * uFlow * A / uRes;
      vec4 prev = texture2D(tPrev, prevUv);

      vec3 col = mix(cur.rgb, prev.rgb, uPersist * A);
      // les zones très claires de la mémoire (traînées) restent plus longtemps
      float pl = dot(prev.rgb, vec3(0.299, 0.587, 0.114));
      float glow = smoothstep(0.9, 0.99, pl) * A;
      col = max(col, prev.rgb * uTrail * glow);

      // 3. points lumineux qui tournoient (leurs positions successives, gardées
      //    en mémoire et charriées, dessinent des traînées en pointillés)
      float cellPx = 70.0;
      vec2 cell = floor(px / cellPx);
      float spark = 0.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 c = cell + vec2(float(i), float(j));
          float r = h2(c + uSeed);
          if (r < 1.0 - uSparks * A) continue;
          float sp = 0.6 + 1.6 * h2(c * 3.1);
          float ph = h2(c * 7.7) * 6.2831;
          vec2 orbit = vec2(sin(uTime * sp * 4.0 + ph), sin(uTime * sp * 5.3 + ph * 2.0)) * cellPx * 0.48;
          vec2 pos = (c + 0.5) * cellPx + orbit;
          float d = length(px - pos);
          spark = max(spark, 1.0 - smoothstep(uSparkSize * 0.5, uSparkSize, d));
        }
      }
      col = max(col, vec3(spark * 0.95));

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PixelFlowPass extends Pass {
  constructor() {
    super();
    this.uniforms = THREE.UniformsUtils.clone(shader.uniforms);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
    });
    this.quad = new FullScreenQuad(this.material);
    const opts = { type: THREE.HalfFloatType };
    this.prevA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.prevB = new THREE.WebGLRenderTarget(1, 1, opts);
  }

  setSize(w, h) {
    this.prevA.setSize(w, h);
    this.prevB.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    const pr = renderer.getPixelRatio();
    u.uRows.value = FLOW.rows * pr;
    u.uRowShift.value = FLOW.rowShift * pr;
    u.uFlow.value = FLOW.flow * pr;
    u.uSwirl.value = FLOW.swirl;
    u.uWarp.value = FLOW.warp * pr;
    u.uPersist.value = FLOW.persist;
    u.uSparks.value = FLOW.sparks;
    u.uSparkSize.value = FLOW.sparkSize * pr;
    u.uTrail.value = FLOW.trail;
    u.tDiffuse.value = readBuffer.texture;
    u.tPrev.value = this.prevA.texture;

    // 1. mémoire pour la frame suivante  2. sortie  (effet à 0 = simple recopie)
    renderer.setRenderTarget(this.prevB);
    this.quad.render(renderer);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
    [this.prevA, this.prevB] = [this.prevB, this.prevA];
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
    this.prevA.dispose();
    this.prevB.dispose();
  }
}
