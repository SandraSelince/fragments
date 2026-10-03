import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * Effet ÉCLATS (glitch de transition de Brume mauve, d'après la vidéo de référence) :
 *  - l'image se découpe en rectangles de tailles variées ;
 *  - dans certains, les pixels sont étirés en rayons vers un point de fuite
 *    (éclats en triangles, comme un miroir brisé qui file en perspective) ;
 *  - d'autres sont étirés à l'horizontale ou à la verticale (fines rayures),
 *    décalés, ou noirs traversés de rayons blancs ;
 *  - le découpage saute plusieurs fois par seconde.
 *
 * Réglages : voir SHARDS ci-dessous.
 */
export const SHARDS = {
  tile: 170, // taille des grands rectangles, en pixels (ils sont redécoupés en plus petits)
  cover: 0.65, // part de l'image touchée au plus fort de l'effet (0 à 1)
  radial: 0.45, // part des éclats étirés en rayons vers le point de fuite
  black: 0.1, // part des rectangles noirs traversés de rayons blancs
  rate: 7, // nombre de "sauts" du découpage par seconde
  offset: 60, // décalage des rectangles déplacés, en pixels
};

const shader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0 },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTile: { value: SHARDS.tile },
    uCover: { value: SHARDS.cover },
    uRadial: { value: SHARDS.radial },
    uBlack: { value: SHARDS.black },
    uRate: { value: SHARDS.rate },
    uOffset: { value: SHARDS.offset },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAmount, uTime, uSeed, uTile, uCover, uRadial, uBlack, uRate, uOffset;
    uniform vec2 uRes;
    varying vec2 vUv;

    float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

    void main() {
      vec4 cur = texture2D(tDiffuse, vUv);
      float A = clamp(uAmount, 0.0, 1.0);
      if (A <= 0.001) { gl_FragColor = cur; return; }

      vec2 px = vUv * uRes;
      float step_ = floor(uTime * uRate) + uSeed;

      // 1. découpage : grands rectangles, redécoupés 0 à 2 fois (largeur et hauteur séparément)
      // colonnes décalées en hauteur : pas de grille régulière
      float colShift = h2(vec2(floor(px.x / uTile), step_ * 0.3)) * uTile;
      px.y += colShift;
      vec2 cellSize = vec2(uTile);
      vec2 cell = floor(px / cellSize);
      for (int k = 0; k < 2; k++) {
        float r = h2(cell * 1.31 + step_ * 0.17 + float(k) * 9.1);
        if (r < 0.35) break;
        if (r < 0.6) cellSize.x *= 0.5; else if (r < 0.85) cellSize.y *= 0.5; else cellSize.y *= 0.125;
        cell = floor(px / cellSize);
      }
      vec2 c0 = cell * cellSize;            // coin du rectangle (pixels)
      vec2 c1 = c0 + cellSize;
      float id = h2(cell * 0.73 + cellSize * 0.011 + step_);
      float kind = h2(cell * 2.9 + cellSize * 0.031 + step_ * 1.7);

      // rectangle non touché
      if (id > uCover * A) { gl_FragColor = cur; return; }

      // point de fuite : près du centre, il saute d'un découpage à l'autre
      px.y -= colShift;         // position réelle à l'écran
      c0.y -= colShift; c1.y -= colShift;
      vec2 F = uRes * (0.5 + (vec2(h2(vec2(step_, 1.0)), h2(vec2(step_, 2.0))) - 0.5) * 0.5);
      vec2 d = px - F;
      float ang = atan(d.y, d.x);
      vec2 dir = d / max(length(d), 1.0);

      vec3 col;
      if (kind < uRadial) {
        // 2a. éclat : chaque rayon prend la couleur d'un seul point (pixels étirés vers le point de fuite)
        float rTile = length(((c0 + c1) * 0.5) - F) * mix(0.4, 1.1, h2(cell + 4.0));
        vec2 sp = F + dir * rTile;
        col = texture2D(tDiffuse, clamp(sp / uRes, 0.0, 1.0)).rgb;
        // facettes : légère variation de lumière par tranche d'angle (aspect de verre brisé)
        float facet = h2(vec2(floor(ang * 18.0 / 3.1416), id * 50.0));
        col *= 0.8 + 0.4 * facet;
      } else if (kind < uRadial + uBlack) {
        // 2b. rectangle noir traversé de rayons blancs
        float ray = h2(vec2(floor(ang * 220.0), step_));
        float on = step(0.82, ray) * step(0.35, fract(length(d) / 40.0 + ray * 3.0));
        col = vec3(on * (0.6 + 0.4 * ray));
      } else if (kind < uRadial + uBlack + 0.2) {
        // 2c. rayures : le pixel du bord gauche (ou haut) est étiré sur tout le rectangle
        bool horiz = h2(cell + 7.0) > 0.4;
        vec2 sp = horiz ? vec2(c0.x, px.y) : vec2(px.x, c1.y);
        col = texture2D(tDiffuse, sp / uRes).rgb;
      } else {
        // 2d. rectangle décalé : un autre morceau de l'image
        vec2 off = (vec2(h2(cell + 11.0), h2(cell + 13.0)) - 0.5) * 2.0 * uOffset;
        col = texture2D(tDiffuse, fract((px + off) / uRes)).rgb;
      }

      // fines arêtes claires sur les bords des rectangles
      vec2 e = min(px - c0, c1 - px);
      float edge = 1.0 - smoothstep(0.0, 1.2, min(e.x, e.y));
      col = mix(col, vec3(0.92), edge * 0.3);

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class ShardsPass extends Pass {
  constructor() {
    super();
    this.uniforms = THREE.UniformsUtils.clone(shader.uniforms);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(w, h) {
    this.uniforms.uRes.value.set(w, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms;
    const pr = renderer.getPixelRatio();
    u.uTile.value = SHARDS.tile * pr;
    u.uCover.value = SHARDS.cover;
    u.uRadial.value = SHARDS.radial;
    u.uBlack.value = SHARDS.black;
    u.uRate.value = SHARDS.rate;
    u.uOffset.value = SHARDS.offset * pr;
    u.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
