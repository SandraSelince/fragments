import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
// MindAR (suivi d'image, open source, licence MIT) — copie locale, adaptée à notre version de Three.js
import { MindARThree } from "./vendor/mindar/mindar-image-three.prod.js";

/**
 * RÉALITÉ AUGMENTÉE sur un tableau.
 *
 * Le téléphone reconnaît le tableau (fichier cible public/ar/cible.mind, calculé
 * à partir de la photo), puis pose dessus :
 *  - le paysage découpé en STRATES (ciel, collines, bandes, champ, premier plan)
 *    qui se décollent de la toile à différentes profondeurs : en bougeant
 *    autour du tableau, on voit le relief comme dans un théâtre de papier ;
 *  - des fleurs 3D qui poussent devant le premier plan ;
 *  - des fragments de papier qui s'envolent de la toile.
 *
 * Pour un autre tableau : remplacer public/ar/tableau.jpg et public/ar/cible.mind,
 * puis ajuster LAYERS (où commencent les strates, de haut en bas).
 *
 * Unités : la largeur du tableau = 1. Le centre du tableau est l'origine,
 * x vers la droite, y vers le haut, z sort du tableau vers le spectateur.
 */

const AR = {
  target: "/ar/cible.mind",
  painting: "/ar/tableau.jpg",
  aspect: 2048 / 1471, // hauteur / largeur du tableau
  popDuration: 1.4, // secondes pour que les strates se décollent
  flowers: 26,
  fragments: 14,
};

// strates : top = où la strate commence (0 = haut du tableau, 1 = bas), depth = décollement
const LAYERS = [
  { top: 0.0, depth: 0.0 }, // ciel (reste sur la toile)
  { top: 0.42, depth: 0.035 }, // collines boisées
  { top: 0.55, depth: 0.07 }, // bandes jaune et rose
  { top: 0.63, depth: 0.105 }, // rangée d'arbres et champ vert
  { top: 0.77, depth: 0.15 }, // premier plan rose et vert
];

const H = AR.aspect;
const start = document.getElementById("ar-start");
const intro = document.getElementById("ar-intro");
const scan = document.getElementById("ar-scan");
const errorMsg = document.getElementById("ar-error");

const mindar = new MindARThree({
  container: document.getElementById("ar-container"),
  imageTargetSrc: AR.target,
  uiLoading: "no",
  uiScanning: "no",
  uiError: "no",
  filterMinCF: 0.0001, // lissage du suivi (moins de tremblements)
  filterBeta: 0.001,
});
const { renderer, scene, camera } = mindar;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a6a, 1.6));
const sunLight = new THREE.DirectionalLight(0xfff2e0, 1.4);
sunLight.position.set(0.4, 1, 1);
scene.add(sunLight);

const anchor = mindar.addAnchor(0);
const root = new THREE.Group();
anchor.group.add(root);

// ---------- strates du tableau ----------
const paintingTex = new THREE.TextureLoader().load(AR.painting);
paintingTex.colorSpace = THREE.SRGBColorSpace;
paintingTex.anisotropy = 8;

const layerMeshes = LAYERS.map((L, i) => {
  // la strate va de son bord haut jusqu'en bas du tableau ; les strates de devant recouvrent le reste
  const h = (1 - L.top) * H;
  const geo = new THREE.PlaneGeometry(1, h, 1, 1);
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * (1 - L.top)); // 0 en bas, (1-top) en haut
  const mat = new THREE.ShaderMaterial({
    transparent: i > 0,
    uniforms: { map: { value: paintingTex }, uFeather: { value: i > 0 ? 0.025 : 0 }, uTopV: { value: 1 - L.top } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float uFeather, uTopV;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        // bord haut adouci, avec une légère irrégularité comme du papier déchiré
        float torn = (sin(vUv.x * 61.0) * 0.5 + sin(vUv.x * 23.0 + 1.3)) * 0.004;
        float a = uFeather > 0.0 ? 1.0 - smoothstep(uTopV - uFeather + torn, uTopV + torn, vUv.y) : 1.0;
        gl_FragColor = vec4(c.rgb, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -H / 2 + h / 2;
  mesh.userData.baseY = mesh.position.y;
  mesh.renderOrder = i;
  mesh.userData.depth = L.depth;
  root.add(mesh);
  return mesh;
});

// ---------- fleurs 3D (Leipoldtia, Poly Haven CC0) ----------
const flowers = [];
const tl = new THREE.TextureLoader();
const loadTex = (url, srgb) => {
  const t = tl.load(url);
  t.flipY = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
const flowerMat = new THREE.MeshStandardMaterial({
  map: loadTex("/flore/leipoldtia_diff.webp", true),
  normalMap: loadTex("/flore/leipoldtia_nor.webp", false),
  alphaTest: 0.5,
  side: THREE.DoubleSide,
  roughness: 0.8,
});
flowerMat.emissive = new THREE.Color(0.6, 0.6, 0.6); // couleurs vives même sans bonne lumière
flowerMat.emissiveMap = flowerMat.map;

new GLTFLoader().load("/flore/leipoldtia.glb", (gltf) => {
  const variants = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    g.computeBoundingBox();
    const b = g.boundingBox;
    const s = 1 / Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    g.scale(s, s, s); // touffe ramenée à une taille 1
    variants.push(g);
  });
  if (!variants.length) return;
  for (let i = 0; i < AR.flowers; i++) {
    const mesh = new THREE.Mesh(variants[i % variants.length], flowerMat);
    // le long du bas du tableau, devant le premier plan ; elles poussent vers le haut
    const x = -0.48 + Math.random() * 0.96;
    mesh.position.set(x, -H / 2 + 0.01 + Math.random() * 0.06, 0.16 + Math.random() * 0.1);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.userData.size = 0.13 + Math.random() * 0.12;
    mesh.userData.delay = 0.4 + Math.random() * 1.2;
    mesh.userData.phase = Math.random() * 6.28;
    mesh.scale.setScalar(0.0001);
    root.add(mesh);
    flowers.push(mesh);
  }
});

// ---------- fragments de papier qui s'envolent ----------
const fragTextures = ["fragment-rose", "fragment-dore", "fragment-beige"].map((n) => {
  const t = tl.load(`/ar/${n}.webp`);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
});
const fragments = [];
for (let i = 0; i < AR.fragments; i++) {
  const w = 0.04 + Math.random() * 0.06;
  const geo = new THREE.PlaneGeometry(w, w * (0.6 + Math.random() * 0.6));
  const mat = new THREE.MeshBasicMaterial({ map: fragTextures[i % 3], transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0 });
  const m = new THREE.Mesh(geo, mat);
  m.userData = {
    x0: -0.45 + Math.random() * 0.9,
    y0: -H / 2 + 0.2 + Math.random() * 0.5,
    speed: 0.04 + Math.random() * 0.05,
    life: 6 + Math.random() * 5,
    t: -Math.random() * 6, // départs décalés
    spin: (Math.random() - 0.5) * 2,
    sway: Math.random() * 6.28,
  };
  root.add(m);
  fragments.push(m);
}

// ---------- apparition / disparition ----------
let foundAt = -1;
const clock = new THREE.Clock();
anchor.onTargetFound = () => {
  foundAt = clock.getElapsedTime();
  scan.hidden = true;
};
anchor.onTargetLost = () => {
  scan.hidden = false;
};

const camLocal = new THREE.Vector3();
const ease = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

function animate() {
  const t = clock.getElapsedTime();
  const dt = Math.min(clock.getDelta(), 0.05);
  const since = foundAt < 0 ? 0 : t - foundAt;
  const pop = ease(since / AR.popDuration);

  // les strates se décollent, avec une très légère respiration.
  // Vue de face, une strate avancée paraît plus grande : on la réduit d'autant,
  // pour que le tableau garde exactement sa taille et que seul le relief change.
  camLocal.set(0, 0, 0);
  root.worldToLocal(camLocal.copy(camera.position));
  const dist = Math.max(0.3, camLocal.z);
  layerMeshes.forEach((m, i) => {
    const z = m.userData.depth * pop * (1 + 0.04 * Math.sin(t * 0.8 + i));
    const k = (dist - z) / dist;
    m.position.z = z;
    m.scale.set(k, k, 1);
    m.position.y = m.userData.baseY * k;
  });

  // les fleurs poussent puis se balancent
  for (const f of flowers) {
    const g = ease((since - f.userData.delay) / 1.6);
    f.scale.setScalar(Math.max(0.0001, f.userData.size * g));
    f.rotation.z = Math.sin(t * 1.3 + f.userData.phase) * 0.06;
  }

  // les fragments montent en tourbillonnant et s'éloignent de la toile
  for (const m of fragments) {
    const u = m.userData;
    if (foundAt >= 0) u.t += dt;
    const life = u.t / u.life;
    if (life >= 1) {
      u.t = 0;
    }
    const k = Math.max(0, life);
    m.position.set(
      u.x0 + Math.sin(u.t * 0.9 + u.sway) * 0.05,
      u.y0 + u.t * u.speed,
      0.02 + u.t * 0.035
    );
    m.rotation.set(u.t * u.spin * 0.7, u.t * u.spin, u.t * 0.3);
    m.material.opacity = foundAt < 0 || u.t <= 0 ? 0 : Math.min(1, k * 6) * (1 - Math.max(0, (k - 0.75) / 0.25));
  }

  renderer.render(scene, camera);
}

// ---------- démarrage (après un geste : obligatoire pour la caméra sur iPhone) ----------
start.addEventListener("click", async () => {
  start.disabled = true;
  try {
    await mindar.start();
    intro.classList.add("is-hidden");
    scan.hidden = false;
    renderer.setAnimationLoop(animate);
    window.__ar = { mindar, anchor, get found() { return foundAt >= 0; } };
  } catch (e) {
    console.error(e);
    start.disabled = false;
    errorMsg.hidden = false;
  }
});
