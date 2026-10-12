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
 *
 * La même page reconnaît aussi la CARTE DE VISITE « Énigme » (cible n° 1 dans cible.mind) :
 * la vidéo public/ar/enigme-carte.mp4 se pose dessus et tourne en boucle.
 * cible.mind contient 2 cibles : 0 = le tableau, 1 = la carte (calculées ensemble).
 */

const AR = {
  target: "/ar/cible.mind",
  aspect: 2048 / 1471, // hauteur / largeur du tableau (photo de référence)
  popDuration: 1.6, // secondes pour que les calques se décollent
  layersAspect: 2301 / 1750, // hauteur / largeur des calques (même format que le background)
};

// carte de visite « Énigme » : la vidéo couvre toute la carte
const CARTE = {
  video: "/ar/enigme-carte.mp4",
  aspect: 1920 / 1080, // hauteur / largeur de la carte
  fadeIn: 0.8,
  opacity: 0.75, // 1 = vidéo pleine, 0.75 = on devine la carte à travers
};

// ordre de Sandra (liste des calques, 1 = le plus proche) : 1 premier plan, 2 collines rouges, 3 champs jaunes, background
const LAYERS = [
  { image: "/ar/calque-1-fond.webp?v=4", depth: 0 }, // background : ciel, collines vertes, lac
  { image: "/ar/calque-3-champs.webp?v=4", depth: 0.12 }, // calque 3 : champs jaunes
  { image: "/ar/calque-2-collines.webp?v=4", depth: 0.24 }, // calque 2 : collines rouge-prune
  { image: "/ar/calque-4-premier-plan.webp?v=4", depth: 0.38 }, // calque 1 : premier plan vert et rose
];

const start = document.getElementById("ar-start");
const intro = document.getElementById("ar-intro");
const scan = document.getElementById("ar-scan");
const errorMsg = document.getElementById("ar-error");

const mindar = new MindARThree({
  container: document.getElementById("ar-container"),
  imageTargetSrc: AR.target + "?v=2",
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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, AR.layersAspect), mat);
  // le haut des calques est calé sur le haut du tableau
  mesh.userData.baseY = AR.aspect / 2 - AR.layersAspect / 2;
  mesh.renderOrder = i; // du fond vers l'avant
  mesh.userData.depth = L.depth;
  root.add(mesh);
  return mesh;
});

// ---------- la carte « Énigme » : vidéo posée sur la carte ----------
const carteAnchor = mindar.addAnchor(1);
const video = document.createElement("video");
video.src = CARTE.video;
video.loop = true;
video.muted = true; // obligatoire pour la lecture automatique sur téléphone
video.playsInline = true;
video.setAttribute("playsinline", "");
video.setAttribute("webkit-playsinline", "");
video.preload = "auto";
// On ne laisse PAS le navigateur retourner l'image (flipY) : certains téléphones
// (Android/Pixel, iPhone) l'ignorent et la vidéo sort à l'envers. On retourne
// nous-mêmes les coordonnées du plan : le résultat est identique partout.
const videoTex = new THREE.VideoTexture(video);
videoTex.colorSpace = THREE.SRGBColorSpace;
videoTex.flipY = false;
const videoMat = new THREE.MeshBasicMaterial({ map: videoTex, transparent: true, opacity: 0 });
const carteGeo = new THREE.PlaneGeometry(1, CARTE.aspect);
const uv = carteGeo.attributes.uv;
for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
carteAnchor.group.add(new THREE.Mesh(carteGeo, videoMat));
let carteFoundAt = -1;

// ---------- apparition / disparition ----------
let foundAt = -1;
const clock = new THREE.Clock();
const updateScan = () => (scan.hidden = foundAt >= 0 || carteFoundAt >= 0);
anchor.onTargetFound = () => {
  foundAt = clock.getElapsedTime();
  updateScan();
};
anchor.onTargetLost = () => {
  foundAt = -1;
  updateScan();
};
carteAnchor.onTargetFound = () => {
  carteFoundAt = clock.getElapsedTime();
  video.play().catch(() => {});
  updateScan();
};
carteAnchor.onTargetLost = () => {
  carteFoundAt = -1;
  videoMat.opacity = 0;
  video.pause();
  updateScan();
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
    m.position.y = m.userData.baseY * k;
  });

  if (carteFoundAt >= 0) {
    videoMat.opacity = CARTE.opacity * Math.min(1, (t - carteFoundAt) / CARTE.fadeIn);
  }

  renderer.render(scene, camera);
}

// ---------- démarrage (après un geste : obligatoire pour la caméra sur iPhone) ----------
start.addEventListener("click", async () => {
  start.disabled = true;
  // "débloque" la vidéo pendant le geste de l'utilisateur (iPhone)
  video.play().then(() => video.pause()).catch(() => {});
  try {
    await mindar.start();
    intro.classList.add("is-hidden");
    scan.hidden = false;
    renderer.setAnimationLoop(animate);
    window.__ar = { mindar, anchor, carteAnchor, get found() { return foundAt >= 0; }, get carte() { return carteFoundAt >= 0; } };
  } catch (e) {
    console.error(e);
    start.disabled = false;
    errorMsg.hidden = false;
  }
});
