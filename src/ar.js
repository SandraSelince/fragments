import * as THREE from "three";
// MindAR (suivi d'image, open source, licence MIT) — copie locale, adaptée à notre version de Three.js
import { MindARThree } from "./vendor/mindar/mindar-image-three.prod.js";
import "./analytics.js"; // statistiques de visite (Vercel)

/**
 * RÉALITÉ AUGMENTÉE sur un tableau.
 *
 * Le téléphone reconnaît le tableau (fichier cible public/ar/cible.mind, calculé
 * à partir de la photo public/ar/tableau.jpg), puis pose dessus, exactement à sa
 * place, la vidéo TouchDesigner du tableau (public/ar/collage20-ar.mp4), en boucle.
 * Elle apparaît en fondu quand le tableau est reconnu et se met en pause quand on le perd.
 *
 * Pour un autre tableau : remplacer tableau.jpg + cible.mind + la vidéo (même cadrage que la photo).
 *
 * Unités : la largeur du tableau = 1, le centre du tableau est l'origine.
 */

const AR = {
  target: "/ar/cible.mind",
  video: "/ar/collage20-ar.mp4",
  aspect: 2048 / 1471, // hauteur / largeur du tableau (photo de référence)
  fadeIn: 0.8, // secondes de fondu à l'apparition
};

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

// ---------- la vidéo, posée sur le tableau ----------
const video = document.createElement("video");
video.src = AR.video;
video.loop = true;
video.muted = true; // obligatoire pour la lecture automatique sur téléphone
video.playsInline = true;
video.setAttribute("playsinline", "");
video.setAttribute("webkit-playsinline", "");
video.crossOrigin = "anonymous";
video.preload = "auto";

const videoTex = new THREE.VideoTexture(video);
videoTex.colorSpace = THREE.SRGBColorSpace;
const material = new THREE.MeshBasicMaterial({ map: videoTex, transparent: true, opacity: 0 });
const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, AR.aspect), material);
anchor.group.add(plane);

// ---------- apparition / disparition ----------
let foundAt = -1;
const clock = new THREE.Clock();
anchor.onTargetFound = () => {
  foundAt = clock.getElapsedTime();
  scan.hidden = true;
  video.play().catch(() => {});
};
anchor.onTargetLost = () => {
  foundAt = -1;
  material.opacity = 0;
  scan.hidden = false;
  video.pause();
};

function animate() {
  const t = clock.getElapsedTime();
  if (foundAt >= 0) material.opacity = Math.min(1, (t - foundAt) / AR.fadeIn);
  renderer.render(scene, camera);
}

// ---------- démarrage (après un geste : obligatoire pour la caméra et la vidéo sur iPhone) ----------
start.addEventListener("click", async () => {
  start.disabled = true;
  // "débloque" la vidéo pendant le geste de l'utilisateur (iOS)
  video.play().then(() => video.pause()).catch(() => {});
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
