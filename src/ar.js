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
 * UN SEUL LIEN pour toutes les œuvres : la même page reconnaît aussi les œuvres
 * de la liste VIDEOS ; seule la vidéo de l'œuvre visée se met en marche.
 * cible.mind contient : 0 = le tableau en calques, 1 = la carte Énigme, 2 = tempête de nuit (déclenchée par l'aquarelle public/ar/tempete.jpg).
 * Pour ajouter une œuvre : ajouter sa cible dans cible.mind + une ligne dans VIDEOS.
 */

const AR = {
  target: "/ar/cible.mind",
  aspect: 2048 / 1471, // hauteur / largeur du tableau (photo de référence)
  popDuration: 1.6, // secondes pour que les calques se décollent
  layersAspect: 2301 / 1750, // hauteur / largeur des calques (même format que le background)
};

// œuvres qui lancent une vidéo : index = n° de la cible dans cible.mind
// (0 = le tableau en calques ; les vidéos commencent à 1)
// aspect = hauteur / largeur ; opacity 1 = vidéo pleine, 0.75 = on devine l'œuvre à travers
const VIDEOS = [
  { index: 1, name: "carte Énigme", video: "/ar/enigme-carte.mp4", aspect: 1920 / 1080, opacity: 0.75 },
  { index: 2, name: "tempête de nuit", video: "/ar/tempete.mp4", aspect: 1518 / 1036, opacity: 0.8 },
];
const FADE_IN = 0.8; // secondes de fondu à l'apparition d'une vidéo

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
  imageTargetSrc: AR.target + "?v=4",
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

let foundAt = -1;
const clock = new THREE.Clock();
const updateScan = () => (scan.hidden = foundAt >= 0 || videoTargets.some((T) => T.foundAt >= 0));

// ---------- les œuvres vidéo : chaque vidéo ne joue que sur SON œuvre ----------
// On ne laisse PAS le navigateur retourner l'image (flipY) : certains téléphones
// (Android/Pixel, iPhone) l'ignorent et la vidéo sort à l'envers. On retourne
// nous-mêmes les coordonnées du plan : le résultat est identique partout.
const videoTargets = VIDEOS.map((V) => {
  const anchor = mindar.addAnchor(V.index);
  const video = document.createElement("video");
  video.src = V.video;
  video.loop = true;
  video.muted = true; // obligatoire pour la lecture automatique sur téléphone
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "metadata";
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0 });
  const geo = new THREE.PlaneGeometry(1, V.aspect);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  anchor.group.add(new THREE.Mesh(geo, mat));
  const T = { ...V, anchor, video, mat, foundAt: -1 };
  anchor.onTargetFound = () => {
    T.foundAt = clock.getElapsedTime();
    video.play().catch(() => {});
    updateScan();
  };
  anchor.onTargetLost = () => {
    T.foundAt = -1;
    mat.opacity = 0;
    video.pause();
    updateScan();
  };
  return T;
});

// ---------- apparition / disparition ----------
anchor.onTargetFound = () => {
  foundAt = clock.getElapsedTime();
  updateScan();
};
anchor.onTargetLost = () => {
  foundAt = -1;
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

  for (const T of videoTargets) {
    if (T.foundAt >= 0) T.mat.opacity = T.opacity * Math.min(1, (t - T.foundAt) / FADE_IN);
  }

  renderer.render(scene, camera);
}

// ---------- démarrage (après un geste : obligatoire pour la caméra sur iPhone) ----------
// suivi des étapes du démarrage, affiché si ça bloque (pour savoir où)
let step = "chargement de la page";
const gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
if (gum) {
  navigator.mediaDevices.getUserMedia = (c) => {
    step = "attente de l'autorisation caméra";
    return gum(c).then(
      (stream) => {
        step = "caméra ouverte, image en attente";
        return stream;
      },
      (err) => {
        step = "caméra refusée (" + err.name + ")";
        throw err;
      }
    );
  };
}

start.addEventListener("click", async () => {
  start.disabled = true;
  step = "démarrage";
  const label = start.textContent;
  start.textContent = "Chargement…";
  errorMsg.hidden = true;
  // si rien ne se passe, on explique quoi faire au lieu de rester bloqué
  const watchdog = setTimeout(() => {
    errorMsg.textContent =
      "C'est long… Vérifie qu'une fenêtre « Autoriser la caméra » n'attend pas ta réponse. " +
      "Si le lien a été ouvert depuis Instagram, WhatsApp ou LinkedIn, ouvre-le plutôt dans Chrome ou Safari. " +
      "[étape : " + step + "]";
    errorMsg.hidden = false;
  }, 12000);
  // (les vidéos sont muettes : elles ont le droit de démarrer seules, pas besoin de les « débloquer »
  // ici — ça évite que le téléphone décode 2 vidéos en même temps que la caméra démarre)
  try {
    await mindar.start();
    step = "prêt";
    intro.classList.add("is-hidden");
    scan.hidden = false;
    renderer.setAnimationLoop(animate);
    window.__ar = { mindar, anchor, videoTargets, get found() { return foundAt >= 0; }, get playing() { return videoTargets.filter((T) => T.foundAt >= 0).map((T) => T.name); } };
    clearTimeout(watchdog);
  } catch (e) {
    clearTimeout(watchdog);
    console.error(e);
    start.disabled = false;
    start.textContent = label;
    const name = (e && e.name) || "";
    errorMsg.textContent =
      name === "NotAllowedError"
        ? "La caméra est refusée. Touche le cadenas à gauche de l'adresse, autorise la caméra, puis recharge la page."
        : name === "NotReadableError"
        ? "La caméra est déjà utilisée par une autre application. Ferme-la, puis recharge la page."
        : "La caméra n'a pas pu démarrer (" + (name || "erreur") + "). Recharge la page et réessaie.";
    errorMsg.hidden = false;
  }
});
