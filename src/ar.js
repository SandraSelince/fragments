import * as THREE from "three";
// MindAR (suivi d'image, open source, licence MIT) — copie locale, adaptée à notre version de Three.js
import { MindARThree } from "./vendor/mindar/mindar-image-three.prod.js";
import "./analytics.js"; // statistiques de visite (Vercel)

/**
 * RÉALITÉ AUGMENTÉE EN CALQUES sur un tableau (principe « layers of reality »).
 *
 * Le téléphone reconnaît le tableau (public/ar/cible.mind, calculé depuis
 * public/ar/tableau.jpg), puis pose dessus 4 calques peints (PNG/WebP transparents),
 * chacun à une profondeur différente. De face, l'image est à la taille exacte du
 * tableau ; quand on bouge le téléphone autour, les calques glissent les uns devant
 * les autres et le paysage prend du relief, comme un théâtre de papier.
 *
 * Pour changer : remplacer les fichiers dans public/ar/ et ajuster LAYERS
 * (depth = décollement, en fraction de la largeur du tableau ; l'ordre = du fond vers l'avant).
 */

const AR = {
  target: "/ar/cible.mind",
  aspect: 2048 / 1471, // hauteur / largeur du tableau (photo de référence)
  popDuration: 1.6, // secondes pour que les calques se décollent
};

// ordre de Sandra (liste des calques, 1 = le plus proche) : 1 premier plan, 2 collines, 3 champs, background
const LAYERS = [
  { image: "/ar/calque-1-fond.webp", depth: 0 }, // background : ciel, collines vertes, lac
  { image: "/ar/calque-3-champs.webp", depth: 0.05 }, // calque 3 : champs jaunes
  { image: "/ar/calque-2-collines.webp", depth: 0.1 }, // calque 2 : collines rouge-prune
  { image: "/ar/calque-4-premier-plan.webp", depth: 0.16 }, // calque 1 : premier plan vert et rose
];

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

const anchor = mindar.addAnchor(0);
const root = new THREE.Group();
anchor.group.add(root);

// ---------- les calques ----------
const loader = new THREE.TextureLoader();
const layerMeshes = LAYERS.map((L, i) => {
  const tex = loader.load(L.image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, AR.aspect), mat);
  mesh.renderOrder = i; // du fond vers l'avant
  mesh.userData.depth = L.depth;
  root.add(mesh);
  return mesh;
});

// ---------- apparition / disparition ----------
let foundAt = -1;
const clock = new THREE.Clock();
anchor.onTargetFound = () => {
  foundAt = clock.getElapsedTime();
  scan.hidden = true;
};
anchor.onTargetLost = () => {
  foundAt = -1;
  scan.hidden = false;
};

const ease = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);
const camLocal = new THREE.Vector3();

function animate() {
  const t = clock.getElapsedTime();
  const since = foundAt < 0 ? 0 : t - foundAt;
  const pop = ease(since / AR.popDuration);

  // distance du téléphone au tableau, pour garder la taille apparente exacte vue de face
  root.worldToLocal(camLocal.copy(camera.position));
  const dist = Math.max(0.3, camLocal.z);

  layerMeshes.forEach((m, i) => {
    // chaque calque apparaît en fondu, du fond vers l'avant, puis se décolle
    m.material.opacity = foundAt < 0 ? 0 : ease((since - i * 0.15) / 0.6);
    const z = m.userData.depth * pop * (1 + 0.03 * Math.sin(t * 0.7 + i)); // légère respiration
    const k = (dist - z) / dist;
    m.position.z = z;
    m.scale.set(k, k, 1);
  });

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
