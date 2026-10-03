import * as THREE from "three";
import "./style.css";
import { landscapes } from "./landscapes.js";
import { buildTerrainFromImage } from "./heightmap.js";
import { createParticleField } from "./particles.js";
import { createTerrainMaterial } from "./terrainMaterial.js";
import { createLivingElements } from "./living.js";
import { createFlora } from "./flora.js";
import { createTrees } from "./trees.js";
import { createBackdrop } from "./backdrop.js";
import { createHorizon } from "./horizon.js";
import { createLightFx, LIGHT } from "./lightFx.js";
import { createSound } from "./sound.js";

/**
 * Promenade 3D à l'intérieur d'une peinture.
 * Mécanisme repris de l'exemple officiel Three.js "webgl_terrain_fog"
 * (terrain généré + THREE.Fog + avancer/reculer au clic maintenu), mais :
 * - le relief vient d'une image de peinture (voir heightmap.js), pas de bruit ;
 * - la texture plaquée sur le relief est cette même image ;
 * - la couleur du brouillard est extraite de l'image (ou fixée en config) ;
 * - éclairage plat (ambiant + une lumière diffuse douce), matériau Lambert
 *   sans reflet spéculaire, pour garder un rendu "peint".
 */

const EYE_HEIGHT = 5; // hauteur des yeux au-dessus du sol
const MOVE_SPEED = 42; // unités de scène par seconde
const LOOK_SPEED = 0.0025; // radians par pixel de glissement souris
const PITCH_LIMIT = 0.55; // radians (~31°) — empêche de retourner la vue
const EDGE_MARGIN = 12; // marge pour ne pas marcher hors du terrain
const BASE_FOG_DENSITY = 0.01; // densité de référence, multipliée par fogDensity du paysage

// ---------- Scène ----------

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.rotation.order = "YXZ"; // yaw puis pitch, sans roulis — évite le gimbal lock d'un FPS

// Éclairage doux et plat : pas de spéculaire (MeshLambertMaterial n'en a pas),
// une lumière ambiante forte + une seule directionnelle légère pour un très
// léger modelé, comme une lumière de jour diffuse et non un projecteur.
scene.add(new THREE.AmbientLight(0xffffff, 0.5)); // était 0.85 : trop plat, le relief ne se lisait pas
const sun = new THREE.DirectionalLight(0xfff4e6, 1.1); // était 0.35
sun.position.set(-160, 90, -60); // plus rasante, de côté : modèle les pentes
sun.color.set(LIGHT.sunColor);
sun.position.copy(LIGHT.sunDirection).multiplyScalar(200); // même direction que le soleil visible / lens flare

// Lens flare, bloom, rayons de soleil, vignettage, grain (voir lightFx.js)
const lightFx = createLightFx({ renderer, scene, camera });
scene.add(sun);

// ---------- État du terrain courant ----------

let currentMesh = null;
let currentGetHeightAt = () => 0;
let currentTerrainSize = 400;
let currentParticles = null;
let currentLiving = null; // eau, oiseaux, papiers volants (voir living.js)
let currentFloras = [];
let currentTrees = null; // arbres (voir trees.js)
let currentHorizon = null; // terrain prolongé en miroir au-delà des bords (voir horizon.js)
let currentBackdrop = null; // montagnes lointaines (voir backdrop.js) // champs de fleurs 3D, une entrée par espèce (voir flora.js)
let currentWaterLevel = -Infinity;
let currentWaterAt = () => -Infinity; // hauteur de l'eau à un endroit (lac ou mer)

async function loadLandscape(landscape) {
  const { geometry, texture, skyColor, groundColor, getHeightAt, terrainSize, heightScale, lake } =
    await buildTerrainFromImage(landscape.image, {
      depthUrl: landscape.depthImage,
      invertHeight: landscape.invertHeight,
      relief: landscape.relief,
      lake: landscape.lake,
    });

  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh.material.map?.dispose();
    currentMesh.material.userData.fragmentTextures?.forEach((t) => t.dispose());
    currentMesh.material.dispose();
  }

  // netteté : filtrage anisotrope, sinon la texture devient floue dès qu'on regarde le sol en biais
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const material = createTerrainMaterial({
    texture,
    fragments: landscape.fragments,
    maxHeight: heightScale,
    saturation: landscape.saturation ?? 1,
    unlit: landscape.unlit ?? 0.5,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Horizon infini (landscape.horizon) : la peinture et le relief continuent en miroir au-delà des bords
  if (currentHorizon) {
    scene.remove(currentHorizon.object);
    currentHorizon.dispose();
    currentHorizon = null;
  }
  if (landscape.horizon) {
    texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.needsUpdate = true;
    currentHorizon = createHorizon({ terrainSize, getHeightAt, material, ...landscape.horizon });
    scene.add(currentHorizon.object);
  }

  currentMesh = mesh;
  currentGetHeightAt = getHeightAt;
  currentTerrainSize = terrainSize;

  lightFx.setStyle(landscape.glitch ?? "dream"); // style des épisodes de glitch

  const fogColor =
    landscape.fogColor != null ? new THREE.Color(landscape.fogColor) : skyColor;
  // la même saturation s'applique au ciel/brouillard pour rester cohérent avec le terrain
  if (landscape.saturation && landscape.saturation !== 1) {
    const hsl = {};
    fogColor.getHSL(hsl);
    fogColor.setHSL(hsl.h, Math.min(1, hsl.s * landscape.saturation), hsl.l);
  }
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(
    fogColor,
    BASE_FOG_DENSITY * (landscape.fogDensity ?? 1)
  );

  // Couche de particules atmosphériques — même scène, même palette que le
  // terrain courant (voir particles.js pour le détail des réglages).
  if (currentParticles) {
    scene.remove(currentParticles.points);
    currentParticles.dispose();
  }
  currentParticles = createParticleField({
    terrainSize,
    heightScale,
    paletteColors: [skyColor, groundColor],
  });
  scene.add(currentParticles.points);

  // Éléments vivants : eau, oiseaux, papiers de collage qui volent.
  if (currentLiving) {
    scene.remove(currentLiving.group);
    currentLiving.dispose();
  }
  currentLiving = createLivingElements({
    living: landscape.living,
    terrainSize,
    maxHeight: heightScale,
    skyColor: fogColor,
    fragments: landscape.fragments,
    getHeightAt,
    lake,
  });
  currentWaterLevel = currentLiving.waterLevel;
  currentWaterAt = currentLiving.waterAt;
  scene.add(currentLiving.group);

  // Arbres (landscape.trees) et montagnes lointaines (landscape.backdrop)
  for (const o of [currentTrees, currentBackdrop]) {
    if (o) {
      scene.remove(o.group || o.object);
      o.dispose();
    }
  }
  currentTrees = null;
  currentBackdrop = null;
  if (landscape.trees) {
    currentTrees = createTrees({
      config: landscape.trees,
      terrainSize,
      maxHeight: heightScale,
      getHeightAt,
      waterAt: currentWaterAt,
      startZ: terrainSize / 2 - EDGE_MARGIN,
    });
    scene.add(currentTrees.group);
  }
  if (landscape.backdrop) {
    currentBackdrop = createBackdrop({ ...landscape.backdrop, hazeColor: fogColor });
    scene.add(currentBackdrop.object);
  }

  // Fleurs 3D semées sur le relief (voir flora.js).
  // landscape.flora : false = aucune ; {...} = une espèce ; [{...}, {...}] = plusieurs espèces mélangées.
  currentFloras.forEach((f) => {
    scene.remove(f.group);
    f.dispose();
  });
  currentFloras = [];
  if (landscape.flora !== false) {
    const species = Array.isArray(landscape.flora) ? landscape.flora : [landscape.flora || {}];
    for (const config of species) {
      const f = createFlora({
        config,
        terrainSize,
        maxHeight: heightScale,
        getHeightAt,
        waterLevel: currentWaterLevel,
        waterAt: currentWaterAt,
        startZ: terrainSize / 2 - EDGE_MARGIN,
      });
      scene.add(f.group);
      currentFloras.push(f);
    }
  }

  // Position de départ : bord "premier plan" du terrain (voir le commentaire
  // dans heightmap.js), face à l'horizon qui se dévoile dans le brouillard.
  yaw = 0;
  pitch = 0;
  camera.position.set(0, 0, terrainSize / 2 - EDGE_MARGIN);
  camera.position.y = Math.max(currentGetHeightAt(0, camera.position.z), currentWaterAt(0, camera.position.z)) + EYE_HEIGHT;
  camera.rotation.set(0, 0, 0);
}

// ---------- Barre de navigation des paysages ----------

const nav = document.getElementById("landscape-nav");

function renderNav(activeId) {
  nav.innerHTML = "";
  for (const landscape of landscapes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "landscape-nav__item";
    // pas de texte visible : un bâton ; le nom reste lisible au survol et par les lecteurs d'écran
    btn.setAttribute("aria-label", landscape.name);
    btn.title = landscape.name;
    if (landscape.id === activeId) {
      btn.classList.add("is-active");
      btn.setAttribute("aria-current", "true");
    }
    btn.addEventListener("click", async () => {
      if (landscape.id === activeId) return;
      await goToLandscape(landscape);
    });
    nav.appendChild(btn);
  }
}

// ---------- Intro ----------

// Bande son + bouton "Sound" (voir sound.js)
const sound = createSound({
  src: "/audio/pale-fluorescent-nostalgia.mp3",
  button: document.getElementById("sound-toggle"),
});

// Pas d'écran d'accueil : on arrive directement dans le paysage.
// Les navigateurs interdisent de lancer le son avant une action de l'utilisateur :
// il démarre au premier clic ou à la première touche. La consigne de navigation
// s'efface d'elle-même après quelques secondes ou dès qu'on bouge.
const controlsHint = document.getElementById("controls-hint");
let hintTimer = setTimeout(() => controlsHint?.classList.add("is-hidden"), 7000);
function dismissIntro() {
  sound.start();
  controlsHint?.classList.add("is-hidden");
  clearTimeout(hintTimer);
}
// démarre au premier clic, toucher ou touche du clavier (flèches comprises)
for (const ev of ["pointerdown", "touchend", "keydown"]) {
  window.addEventListener(ev, dismissIntro);
}

// ---------- Navigation : clic maintenu pour avancer/reculer, glisser pour tourner ----------

let yaw = 0;
let pitch = 0;
let movingForward = false;
let movingBackward = false;
let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------- Tactile (mobile) : appui long ----------
// en haut de l'écran = avancer, en bas = reculer, à gauche / à droite = tourner.
// Si le doigt glisse avant la fin de l'appui, on regarde autour (comme à la souris).
const HOLD_DELAY = 220; // ms avant que l'appui devienne un "appui long"
const TOUCH_TURN_SPEED = 1.3; // radians par seconde
let touchTimer = 0;
let touchMoved = 0;
const touchHold = { forward: false, backward: false, left: false, right: false };
function clearTouchHold() {
  clearTimeout(touchTimer);
  touchHold.forward = touchHold.backward = touchHold.left = touchHold.right = false;
}
function startTouchHold(x, y) {
  const fy = y / window.innerHeight;
  const fx = x / window.innerWidth;
  if (fy < 0.33) touchHold.forward = true;
  else if (fy > 0.67) touchHold.backward = true;
  else if (fx < 0.5) touchHold.left = true;
  else touchHold.right = true;
}

canvas.addEventListener("pointerdown", (e) => {
  dismissIntro();
  dragging = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  if (e.pointerType === "touch") {
    // tactile : on attend de savoir si c'est un appui long ou un glissement
    clearTouchHold();
    touchMoved = 0;
    const x = e.clientX, y = e.clientY;
    touchTimer = setTimeout(() => {
      if (touchMoved < 12) startTouchHold(x, y);
    }, HOLD_DELAY);
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  // Reculer : clic droit, c.-à-d. sur le trackpad du Mac le clic en bas à droite,
  // le clic à deux doigts, ou Ctrl + clic (macOS l'envoie comme un clic gauche avec Ctrl).
  const secondary = e.button === 2 || (e.button === 0 && e.ctrlKey);
  if (secondary) movingBackward = true;
  else if (e.button === 0) movingForward = true;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  if (e.pointerType === "touch") {
    touchMoved += Math.abs(dx) + Math.abs(dy);
    // pendant un appui long, le doigt peut bouger un peu sans faire tourner la vue
    if (touchHold.forward || touchHold.backward || touchHold.left || touchHold.right) return;
    if (touchMoved < 12) return;
  }
  yaw -= dx * LOOK_SPEED;
  pitch -= dy * LOOK_SPEED;
  pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
});

function endDrag(e) {
  clearTouchHold();
  dragging = false;
  movingForward = false;
  movingBackward = false;
  canvas.classList.remove("is-dragging");
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* noop */
  }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// ---------- Clavier : flèche haut = avancer, flèche bas = reculer, gauche/droite = tourner ----------

const keys = { up: false, down: false, left: false, right: false };
const KEY_TURN_SPEED = 1.6; // radians par seconde quand on tourne avec les flèches
const KEYMAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

window.addEventListener("keydown", (e) => {
  const k = KEYMAP[e.key];
  if (!k) return;
  e.preventDefault(); // évite que les flèches fassent défiler la page
  keys[k] = true;
  dismissIntro();
});
window.addEventListener("keyup", (e) => {
  const k = KEYMAP[e.key];
  if (k) keys[k] = false;
});
// si la fenêtre perd le focus pendant qu'une touche est enfoncée, on s'arrête
window.addEventListener("blur", () => {
  keys.up = keys.down = keys.left = keys.right = false;
});

// ---------- Redimensionnement ----------

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  lightFx.setSize(window.innerWidth, window.innerHeight);
});
renderer.setSize(window.innerWidth, window.innerHeight);
lightFx.setSize(window.innerWidth, window.innerHeight);

// ---------- Boucle d'animation ----------

const clock = new THREE.Clock();
const half = () => currentTerrainSize / 2 - EDGE_MARGIN;

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  // tourner avec les flèches gauche/droite
  if (keys.left) yaw += KEY_TURN_SPEED * delta;
  if (keys.right) yaw -= KEY_TURN_SPEED * delta;
  if (touchHold.left) yaw += TOUCH_TURN_SPEED * delta;
  if (touchHold.right) yaw -= TOUCH_TURN_SPEED * delta;

  const goForward = movingForward || keys.up || touchHold.forward;
  const goBackward = movingBackward || keys.down || touchHold.backward;
  if (goForward !== goBackward) {
    const dir = goForward ? 1 : -1;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const step = MOVE_SPEED * delta * dir;
    const limit = half();
    camera.position.x = Math.max(
      -limit,
      Math.min(limit, camera.position.x + forwardX * step)
    );
    camera.position.z = Math.max(
      -limit,
      Math.min(limit, camera.position.z + forwardZ * step)
    );
  }

  // La caméra suit le relief du terrain (comme dans l'exemple de référence) :
  // hauteur du sol sous les pieds + hauteur des yeux, lissée pour éviter les
  // à-coups en passant d'une case de la grille à l'autre.
  const targetY =
    Math.max(currentGetHeightAt(camera.position.x, camera.position.z), currentWaterAt(camera.position.x, camera.position.z)) + EYE_HEIGHT;
  camera.position.y += (targetY - camera.position.y) * Math.min(1, delta * 8);

  camera.rotation.set(pitch, yaw, 0);

  currentParticles?.update(camera, delta, clock.elapsedTime);
  currentLiving?.update(camera, delta, clock.elapsedTime);
  currentFloras.forEach((f) => f.update(camera, delta, clock.elapsedTime));
  currentTrees?.update(camera, delta, clock.elapsedTime);
  currentBackdrop?.update(camera);

  lightFx.render(clock.elapsedTime);
}

// Poignée de débogage, uniquement en développement (npm run dev) : jamais dans la version publiée
if (import.meta.env.DEV) {
  window.__promenade = { camera, scene, get floras() { return currentFloras; } };
}

// ---------- Démarrage ----------

// ---------- Changement d'univers ----------
// Chaque épisode de glitch sert de transition : au plus fort de l'effet, on passe
// à l'univers suivant de la liste (puis on revient au premier après le dernier).
// Mettre GLITCH_CHANGES_UNIVERSE à false pour garder le glitch sans changement.
const GLITCH_CHANGES_UNIVERSE = true;
let currentIndex = 0;
let switching = false;

async function goToLandscape(landscape) {
  if (switching) return;
  switching = true;
  try {
    currentIndex = landscapes.indexOf(landscape);
    renderNav(landscape.id);
    await loadLandscape(landscape);
  } finally {
    switching = false;
  }
}

if (GLITCH_CHANGES_UNIVERSE) {
  lightFx.onEpisodePeak(() => {
    goToLandscape(landscapes[(currentIndex + 1) % landscapes.length]);
  });
}

renderNav(landscapes[0].id);
loadLandscape(landscapes[0]).then(() => animate());
