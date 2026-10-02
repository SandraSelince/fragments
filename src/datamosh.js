import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * Effet DATAMOSH (inspiré de la vidéo de référence) :
 *  - grandes taches NOIRES aux bords en escalier (alignés sur une grille de blocs),
 *    qui dérivent lentement ;
 *  - autour d'elles, des blocs de l'IMAGE PRÉCÉDENTE restent figés et "coulent"
 *    vers le bas, bloc par bloc (marches d'escalier, comme une vidéo compressée cassée) ;
 *  - blocs isolés figés ou aplatis en une seule couleur (macroblocs) ;
 *  - colonnes verticales où l'image est étirée.
 *
 * Technique : une image "mémoire" (rendu précédent) est conservée d'une frame à
 * l'autre (ping-pong de deux render targets). Les blocs touchés lisent cette
 * mémoire au lieu de l'image actuelle, ce qui accumule les traînées.
 *
 * Réglages : voir MOSH ci-dessous.
 */
export const MOSH = {
  block: 22, // taille des blocs en pixels (plus grand = plus grossier)
  holes: 0.2, // quantité de taches noires (0 = aucune)
  stale: 0.14, // largeur de la bordure de blocs figés autour des taches
  scatter: 0.08, // blocs figés isolés partout dans l'image
  smear: 0.04, // colonnes étirées
  drip: 1, // vitesse de coulure des blocs figés (en blocs par frame, 0 = figés)
};

const shader = {
  uniforms: {
    tDiffuse: { value: null },
    tHeld: { value: null },
    uAmount: { value: 0 },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uBlock: { value: MOSH.block },
    uHoles: { value: MOSH.holes },
    uStale: { value: MOSH.stale },
    uScatter: { value: MOSH.scatter },
    uSmear: { value: MOSH.smear },
    uDrip: { value: MOSH.drip },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tHeld;
    uniform float uAmount, uTime, uSeed, uBlock, uHoles, uStale, uScatter, uSmear, uDrip;
    uniform vec2 uRes;
    varying vec2 vUv;

    float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p *= 2.03; a *= 0.5; } return s / 0.9375; }

    void main() {
      vec4 cur = texture2D(tDiffuse, vUv);
      float A = clamp(uAmount, 0.0, 1.0);
      if (A <= 0.001) { gl_FragColor = cur; return; }

      vec2 px = vUv * uRes;
      vec2 blk = floor(px / uBlock);
      vec2 bc = (blk + 0.5) * uBlock / uRes;      // centre du bloc (uv)
      float stepT = floor(uTime * 10.0);           // la "compression" saute par à-coups

      // grandes formes qui dérivent : bruit lu au centre du bloc => bords en escalier
      vec2 q = bc * vec2(uRes.x / uRes.y, 1.0) * 1.1 + vec2(uSeed, uSeed * 0.7) + vec2(uTime * 0.04, -uTime * 0.11);
      float n = clamp((fbm(q) - 0.5) * 2.6 + 0.5, 0.0, 1.0); // contraste du bruit : vraies grandes taches
      float holeTh = 1.0 - uHoles * A;
      float isHole = step(holeTh, n);
      float isStale = step(holeTh - uStale * A, n) * (1.0 - isHole);

      // blocs figés isolés + macroblocs aplatis
      float r = h2(blk + stepT * 0.37 + uSeed);
      float scattered = step(1.0 - uScatter * A, r);
      float flat_ = step(1.0 - uScatter * 0.5 * A, h2(blk * 1.7 + stepT + 3.1));

      // image mémoire décalée vers le bas d'un nombre entier de blocs => coulure en marches
      float dripBlocks = floor(1.0 + h2(vec2(blk.x, uSeed)) * 2.0) * uDrip;
      vec2 heldUv = vUv + vec2(0.0, dripBlocks * uBlock / uRes.y);
      vec4 held = texture2D(tHeld, clamp(heldUv, 0.0, 1.0));

      vec4 col = cur;
      col = mix(col, texture2D(tDiffuse, bc), flat_);          // macrobloc d'une seule couleur
      col = mix(col, held, max(isStale, scattered));           // blocs figés qui coulent

      // colonnes étirées verticalement
      float colId = floor(px.x / uBlock);
      float sm = step(1.0 - uSmear * A, h2(vec2(colId, floor(stepT * 0.25) + uSeed))) * (1.0 - isHole);
      float anchor = h2(vec2(colId, 7.0 + uSeed));
      col = mix(col, texture2D(tDiffuse, vec2(vUv.x, mix(vUv.y, anchor, 0.85))), sm);

      col.rgb = mix(col.rgb, vec3(0.0), isHole);               // taches noires
      gl_FragColor = vec4(col.rgb, 1.0);
    }`,
};

export class DatamoshPass extends Pass {
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
    this.heldA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.heldB = new THREE.WebGLRenderTarget(1, 1, opts);
  }

  setSize(w, h) {
    this.heldA.setSize(w, h);
    this.heldB.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    u.uBlock.value = MOSH.block * renderer.getPixelRatio();
    u.uHoles.value = MOSH.holes;
    u.uStale.value = MOSH.stale;
    u.uScatter.value = MOSH.scatter;
    u.uSmear.value = MOSH.smear;
    u.uDrip.value = MOSH.drip;
    u.tDiffuse.value = readBuffer.texture;
    u.tHeld.value = this.heldA.texture;

    // 1. mémoire pour la frame suivante
    renderer.setRenderTarget(this.heldB);
    this.quad.render(renderer);
    // 2. sortie
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
    // échange
    [this.heldA, this.heldB] = [this.heldB, this.heldA];
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
    this.heldA.dispose();
    this.heldB.dispose();
  }
}
