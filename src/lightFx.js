import * as THREE from "three";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { DatamoshPass } from "./datamosh.js";
import { PixelFlowPass } from "./pixelflow.js";
import { ShardsPass } from "./shards.js";

/**
 * Effets de lumière :
 *  - SOLEIL + LENS FLARE : un soleil bas sur l'horizon avec les reflets
 *    d'objectif (halo, anneaux, hexagones). Il disparaît derrière les montagnes.
 *  - BLOOM : les zones claires "bavent" légèrement, comme une pellicule.
 *  - RAYONS DE SOLEIL (god rays) : des rais de lumière qui partent du soleil
 *    et passent entre les reliefs.
 *  - FINITION : voile chaud du côté du soleil, vignettage, grain léger.
 *
 * Réglages : voir LIGHT ci-dessous.
 */

export const LIGHT = {
  sunDirection: new THREE.Vector3(-0.55, 0.2, -0.8).normalize(), // où est le soleil (bas, devant à gauche)
  sunColor: 0xffd9a8,
  flare: true,
  bloomStrength: 0.35, // 0 = pas de bloom
  bloomThreshold: 0.88,
  raysIntensity: 0.35, // 0 = pas de rayons (était 0.55 : voilait les couleurs)
  warmLeak: 0.07, // voile chaud côté soleil (était 0.14)
  vignette: 0.35,
  grain: 0.035,
};

// ---- ÉPISODES "RÊVE" : glitch + luminescence qui surgissent de temps en temps
// Chaque épisode mélange au hasard 4 effets (inspirés de tes références) :
//  - smear   : bandes verticales où l'image s'étire et coule (pixel smear)
//  - flow    : la matière se liquéfie et tourbillonne comme du marbre
//  - iris    : reflets irisés / holographiques et relief chromé
//  - glow    : grands halos lumineux pêche et bleu qui dérivent
// + traînées de mouvement (l'image laisse des rémanences) pendant l'épisode.
// Touche G : déclencher un épisode tout de suite (pratique pour régler).
export const DREAM = {
  everyMin: 12, // secondes entre deux épisodes (min)
  everyMax: 28, // (max)
  durationMin: 3.5, // durée d'un épisode (min)
  durationMax: 7, // (max)
  intensity: 1, // 0 = désactivé, 1 = normal, 1.5 = plus fort
  trails: 0.82, // rémanence des traînées (0 = aucune, 0.9 = très longues)
};

const DreamShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAmount: { value: 0 },
    uSeed: { value: 0 },
    uMix: { value: new THREE.Vector4(1, 1, 1, 1) }, // smear, flow, iris, glow
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAmount, uSeed;
    uniform vec4 uMix;
    uniform vec2 uRes;
    varying vec2 vUv;

    float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
    float h2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += vnoise(p) * a; p *= 2.02; a *= 0.5; } return s; }
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    void main() {
      float A = uAmount;
      if (A <= 0.001) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 uv = vUv;
      float t = uTime;

      // 1. FLOW : déformation liquide (domain warping), la peinture coule et tourbillonne
      vec2 q = vec2(fbm(uv * 2.5 + t * 0.12 + uSeed), fbm(uv * 2.5 - t * 0.1 + uSeed * 1.7));
      vec2 r = vec2(fbm(uv * 2.5 + 3.5 * q + vec2(1.7, 9.2) + t * 0.08), fbm(uv * 2.5 + 3.5 * q + vec2(8.3, 2.8) - t * 0.07));
      uv += (r - 0.5) * 0.16 * A * uMix.y;

      // 2. SMEAR : colonnes où les pixels sont étirés verticalement vers un point d'ancrage
      float cols = 14.0 + floor(h1(uSeed) * 26.0);
      float ci = floor(vUv.x * cols); // colonnes calculées AVANT la déformation : bandes bien droites
      float stepT = floor(t * 2.5);
      float bandOn = step(1.0 - 0.38 * uMix.x * A, h1(ci * 1.37 + stepT * 0.61 + uSeed));
      float anchor = h1(ci * 3.1 + uSeed + stepT * 0.13);
      float stretch = bandOn * (0.55 + 0.45 * h1(ci + 7.0 + uSeed));
      vec2 suv = vec2(mix(uv.x, vUv.x, bandOn), mix(uv.y, anchor, stretch * 0.9)); // dans une bande : pas de coulure latérale
      suv.y += bandOn * (fract(t * 0.35 + h1(ci)) - 0.5) * 0.05; // la coulure descend lentement

      vec3 col = texture2D(tDiffuse, clamp(suv, 0.0, 1.0)).rgb;
      // fines stries lumineuses dans les bandes étirées
      float stria = h1(floor(uv.x * uRes.x * 0.35) + uSeed);
      col += bandOn * A * uMix.x * (0.03 + 0.28 * step(0.85, stria)) * vec3(1.0, 0.97, 0.92);

      // 3. IRIS : reflets irisés (film mince) + relief chromé tiré de l'image
      vec2 px = 1.5 / uRes;
      float lx = lum(texture2D(tDiffuse, suv + vec2(px.x, 0.0)).rgb) - lum(texture2D(tDiffuse, suv - vec2(px.x, 0.0)).rgb);
      float ly = lum(texture2D(tDiffuse, suv + vec2(0.0, px.y)).rgb) - lum(texture2D(tDiffuse, suv - vec2(0.0, px.y)).rgb);
      float l = lum(col);
      float phase = l * 3.0 + fbm(uv * 4.0 + t * 0.15) * 2.5 + t * 0.25 + (lx - ly) * 20.0;
      vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + phase));
      col = mix(col, col * (0.45 + 0.75 * irid), 0.6 * A * uMix.z);
      float spec = pow(clamp(0.5 + (lx + ly) * 7.0, 0.0, 1.0), 4.0);
      col += spec * 0.3 * A * uMix.z * vec3(1.0, 0.98, 0.95);

      // 4. GLOW : halos lumineux qui dérivent (pêche / bleu glacier)
      vec2 c1 = vec2(0.32 + 0.22 * sin(t * 0.31 + uSeed), 0.52 + 0.2 * cos(t * 0.23 + uSeed));
      vec2 c2 = vec2(0.72 + 0.18 * cos(t * 0.27 + uSeed * 2.0), 0.46 + 0.25 * sin(t * 0.35));
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      float b1 = exp(-dot((uv - c1) * asp, (uv - c1) * asp) * 7.0);
      float b2 = exp(-dot((uv - c2) * asp, (uv - c2) * asp) * 6.0);
      col += (vec3(1.0, 0.72, 0.52) * b1 + vec3(0.45, 0.72, 1.0) * b2) * 0.55 * A * uMix.w;

      // plus de contraste et des sombres bleu nuit, comme dans les références
      vec3 graded = (col - 0.45) * 1.35 + 0.4;
      graded = mix(graded, graded * vec3(0.72, 0.8, 1.0), smoothstep(0.45, 0.0, lum(graded))); // ombres bleutées
      col = mix(col, max(graded, 0.0), 0.8 * min(A, 1.0));
      // bords assombris, halo au centre
      col *= mix(1.0, smoothstep(1.05, 0.3, length((vUv - 0.5) * asp * 0.8)), 0.6 * A);

      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ---- textures du lens flare, dessinées dans un canvas (pas de fichier à fournir)
function flareTexture(draw, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = () =>
  flareTexture((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.12, "rgba(255,240,215,0.85)");
    r.addColorStop(0.4, "rgba(255,200,150,0.18)");
    r.addColorStop(1, "rgba(255,180,120,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  }, 512);
const ringTex = () =>
  flareTexture((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, s * 0.34, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,0)");
    r.addColorStop(0.55, "rgba(200,230,255,0.35)");
    r.addColorStop(0.75, "rgba(255,210,240,0.2)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
const hexTex = () =>
  flareTexture((g, s) => {
    g.translate(s / 2, s / 2);
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      g.lineTo(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45);
    }
    g.closePath();
    const r = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.45);
    r.addColorStop(0, "rgba(255,255,255,0.12)");
    r.addColorStop(1, "rgba(255,255,255,0.4)");
    g.fillStyle = r;
    g.fill();
  });

// ---- passe "rayons + finition"
const RaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVisible: { value: 0 },
    uColor: { value: new THREE.Color(LIGHT.sunColor) },
    uRays: { value: LIGHT.raysIntensity },
    uLeak: { value: LIGHT.warmLeak },
    uVignette: { value: LIGHT.vignette },
    uGrain: { value: LIGHT.grain },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uSunVisible, uRays, uLeak, uVignette, uGrain, uTime, uAspect;
    uniform vec3 uColor;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = base.rgb;

      // rayons : on marche de chaque pixel vers le soleil et on accumule le ciel lumineux traversé
      const int N = 48;
      vec2 delta = (vUv - uSun) / float(N) * 0.9;
      vec2 uv = vUv;
      float decay = 1.0, illum = 0.0;
      for (int i = 0; i < N; i++) {
        uv -= delta;
        vec3 s = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        float l = max(dot(s, vec3(0.299, 0.587, 0.114)) - 0.62, 0.0) * 2.6;
        illum += l * decay;
        decay *= 0.96;
      }
      col += uColor * (illum / float(N)) * uRays * uSunVisible;

      // voile chaud autour du soleil
      vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
      col += uColor * uLeak * uSunVisible * smoothstep(1.1, 0.0, length(d));

      // vignettage + grain
      float v = smoothstep(0.95, 0.3, length(vUv - 0.5));
      col *= mix(1.0, v, uVignette);
      col += (hash(vUv * 1024.0 + fract(uTime) * 100.0) - 0.5) * uGrain;

      gl_FragColor = vec4(col, base.a);
    }`,
};

export function createLightFx({ renderer, scene, camera }) {
  // --- soleil + lens flare, accroché à un objet qui suit la caméra (soleil "à l'infini")
  const sunAnchor = new THREE.Object3D();
  scene.add(sunAnchor);
  const textures = [];
  if (LIGHT.flare) {
    const glow = glowTex(), ring = ringTex(), hex = hexTex();
    textures.push(glow, ring, hex);
    const c = new THREE.Color(LIGHT.sunColor);
    const lensflare = new Lensflare();
    lensflare.addElement(new LensflareElement(glow, 900, 0, c));
    lensflare.addElement(new LensflareElement(glow, 160, 0, new THREE.Color(0xffffff)));
    lensflare.addElement(new LensflareElement(hex, 70, 0.35, new THREE.Color(0xffc9e6)));
    lensflare.addElement(new LensflareElement(hex, 110, 0.55, new THREE.Color(0xb8e3ff)));
    lensflare.addElement(new LensflareElement(ring, 260, 0.75, new THREE.Color(0xffffff)));
    lensflare.addElement(new LensflareElement(hex, 60, 0.9, new THREE.Color(0xfff0c0)));
    lensflare.addElement(new LensflareElement(ring, 420, 1.1, new THREE.Color(0xe8d0ff)));
    sunAnchor.add(lensflare);
  }

  // --- post-traitement
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(size.clone(), LIGHT.bloomStrength, 0.6, LIGHT.bloomThreshold);
  if (LIGHT.bloomStrength > 0) composer.addPass(bloom);
  const afterimage = new AfterimagePass(0);
  composer.addPass(afterimage);
  const dream = new ShaderPass(DreamShader);
  composer.addPass(dream);
  const mosh = new DatamoshPass(); // effet "datamosh" (voir datamosh.js), utilisé quand style = "datamosh"
  composer.addPass(mosh);
  const pixelflow = new PixelFlowPass(); // effet "pixelflow" (voir pixelflow.js) : lignes déplacées + courants
  composer.addPass(pixelflow);
  const shards = new ShardsPass(); // effet "shards" (voir shards.js) : éclats étirés vers un point de fuite
  composer.addPass(shards);
  const STYLES = ["dream", "datamosh", "pixelflow", "shards"];
  let style = "dream"; // style choisi par paysage (voir landscapes.js, champ glitch)
  const rays = new ShaderPass(RaysShader);
  composer.addPass(rays);

  // --- programmation des épisodes
  const rand = (a, b) => a + Math.random() * (b - a);
  let episode = null;
  let onPeak = null; // appelé au plus fort de chaque épisode (voir main.js : changement d'univers)
  let nextAt = rand(6, 12); // le premier arrive assez vite
  let forceNow = false;
  const onKey = (e) => {
    if (e.key === "g" || e.key === "G") forceNow = true;
  };
  window.addEventListener("keydown", onKey);

  function startEpisode(now) {
    // mélange aléatoire : au moins deux effets forts par épisode
    const w = [0, 1, 2, 3].map(() => rand(0.15, 0.6));
    const strong = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, 2);
    strong.forEach((i) => (w[i] = rand(0.8, 1)));
    // le style est figé pour tout l'épisode : celui de l'univers où le glitch commence
    episode = { start: now, dur: rand(DREAM.durationMin, DREAM.durationMax), seed: Math.random() * 100, style };
    dream.uniforms.uMix.value.set(...w);
    dream.uniforms.uSeed.value = episode.seed;
  }

  function dreamAmount(now) {
    if (DREAM.intensity <= 0) return 0;
    if (forceNow || (!episode && now >= nextAt)) {
      forceNow = false;
      startEpisode(now);
    }
    if (!episode) return 0;
    const k = (now - episode.start) / episode.dur;
    // au plus fort du glitch (35 % de l'épisode) : on prévient la promenade, qui change d'univers
    if (!episode.fired && k >= 0.35) {
      episode.fired = true;
      onPeak?.();
    }
    if (k >= 1) {
      episode = null;
      nextAt = now + rand(DREAM.everyMin, DREAM.everyMax);
      return 0;
    }
    // montée rapide, tenue, descente douce + petits "hoquets" de glitch
    const env = THREE.MathUtils.smoothstep(k, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(k, 0.65, 1));
    const stutter = Math.sin(now * 31) > 0.93 ? 1.35 : 1;
    return Math.min(1.5, env * stutter * DREAM.intensity);
  }
  composer.addPass(new OutputPass());

  const sunWorld = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  return {
    render(elapsed) {
      sunWorld.copy(LIGHT.sunDirection).multiplyScalar(900).add(camera.position);
      sunAnchor.position.copy(sunWorld);

      // position du soleil à l'écran, et fondu quand il sort du champ ou passe derrière nous
      camera.getWorldDirection(camDir);
      const facing = camDir.dot(LIGHT.sunDirection);
      const p = sunWorld.clone().project(camera);
      rays.uniforms.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      rays.uniforms.uSunVisible.value = THREE.MathUtils.smoothstep(facing, 0.1, 0.7);
      rays.uniforms.uTime.value = elapsed;
      rays.uniforms.uAspect.value = camera.aspect;

      const amount = dreamAmount(elapsed);
      const epStyle = episode?.style ?? style;
      const moshOn = epStyle === "datamosh";
      const flowOn = epStyle === "pixelflow";
      const shardsOn = epStyle === "shards";
      const special = moshOn || flowOn || shardsOn;
      shards.uniforms.uAmount.value = shardsOn ? amount : 0;
      shards.uniforms.uTime.value = elapsed;
      shards.uniforms.uSeed.value = dream.uniforms.uSeed.value;
      mosh.uniforms.uAmount.value = moshOn ? amount : 0;
      pixelflow.uniforms.uAmount.value = flowOn ? amount : 0;
      pixelflow.uniforms.uTime.value = elapsed;
      pixelflow.uniforms.uSeed.value = dream.uniforms.uSeed.value;
      mosh.uniforms.uTime.value = elapsed;
      mosh.uniforms.uSeed.value = dream.uniforms.uSeed.value;
      dream.uniforms.uAmount.value = special ? 0 : amount;
      dream.uniforms.uTime.value = elapsed;
      afterimage.uniforms.damp.value = special ? 0 : DREAM.trails * Math.min(1, amount);

      composer.render();
    },
    // style des épisodes de glitch : "dream" ou "datamosh"
    // fonction appelée au plus fort de chaque épisode de glitch
    onEpisodePeak(fn) {
      onPeak = fn;
    },
    setStyle(name) {
      style = STYLES.includes(name) ? name : "dream";
    },
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
      const pr = Math.min(window.devicePixelRatio, 1.5);
      dream.uniforms.uRes.value.set(w * pr, h * pr);
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      textures.forEach((t) => t.dispose());
      composer.dispose();
    },
  };
}
