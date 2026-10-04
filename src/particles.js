import * as THREE from "three";
import { QUALITY } from "./device.js";

/**
 * Champ de particules atmosphérique — poussière/pollen en suspension dans le
 * volume 3D du terrain déjà en place (pas un effet 2D à l'écran, pas une
 * couche séparée). Vit dans la même scène et la même boucle d'animation que
 * le terrain et le brouillard (voir main.js) : ce module ne crée ni scène,
 * ni caméra, ni rendu propres — juste un THREE.Points à ajouter/mettre à
 * jour depuis l'extérieur.
 *
 * ---- Palette (réglage : PALETTE_HUE_JITTER / PALETTE_SAT_JITTER / PALETTE_LUM_JITTER) ----
 * Pour cette V1, chaque particule reçoit une couleur PROCÉDURALE : on
 * interpole entre les deux teintes déjà extraites de la toile — ciel et sol,
 * voir extractSkyColor/extractGroundColor dans heightmap.js — avec un t
 * aléatoire par particule, puis on ajoute un léger jitter HSL pour casser
 * l'uniformité (sinon toutes les particules d'un même t seraient identiques).
 * Piste pour une V2 : au lieu d'interpoler seulement 2 couleurs, tirer un
 * pixel aléatoire dans le canvas source de la peinture (le même canvas que
 * celui utilisé pour la heightmap/texture dans heightmap.js — il faudrait
 * l'exposer depuis buildTerrainFromImage) pour donner à chaque particule une
 * vraie couleur exacte de la toile plutôt qu'une teinte interpolée.
 *
 * ---- Mouvement (réglage : DRIFT_AMPLITUDE / DRIFT_FREQUENCY / DRIFT_SPEED) ----
 * Chaque particule dérive autour de sa position d'origine selon un bruit de
 * Perlin 3D (implémentation compacte ci-dessous, sans dépendance externe),
 * échantillonné à 3 décalages de coordonnées différents pour produire un
 * vecteur de déplacement qui varie doucement dans l'espace et le temps —
 * une approximation légère d'un champ "curl noise" (tourbillonnant), sans le
 * coût de calcul d'un vrai rotationnel (dérivées croisées), qui serait inutile
 * ici et coûterait cher à recalculer pour des milliers de particules à 60fps.
 *
 * ---- Interaction (réglage : CAMERA_PUSH_RADIUS / CAMERA_PUSH_STRENGTH) ----
 * Pas de survol souris ici : l'interaction pertinente est la PROXIMITÉ DE LA
 * CAMÉRA. Les particules à moins de CAMERA_PUSH_RADIUS unités de la caméra
 * sont repoussées radialement, avec une force qui décroît avec la distance.
 * Le retour progressif à la position d'origine une fois éloigné n'est pas un
 * minuteur séparé : chaque frame ne calcule qu'une position cible instantanée
 * (dérive + écartement caméra), et un lissage exponentiel ("ressort" doux,
 * réglage SPRING_RATE) rapproche la position affichée de cette cible — dès
 * que la caméra s'éloigne, la cible perd sa composante d'écartement et le
 * lissage referme le nuage tout seul.
 */

const PARTICLE_COUNT = Math.round(5000 * QUALITY.particles); // moitié sur téléphone (voir device.js)
const STAGGER_GROUPS = 2; // répartit la mise à jour sur N frames (voir plus bas) pour tenir le budget performance
const DRIFT_AMPLITUDE = 3.2; // amplitude de la dérive de bruit, en unités de scène
const DRIFT_FREQUENCY = 0.05; // "zoom" spatial du champ de bruit — plus petit = mouvement plus ample et lent
const DRIFT_SPEED = 0.06; // vitesse à laquelle le champ de bruit évolue dans le temps
const SPRING_RATE = 2.2; // vitesse de rappel vers la position cible (plus grand = plus réactif, moins de traîne)
const CAMERA_PUSH_RADIUS = 13; // distance (unités de scène) en dessous de laquelle la caméra écarte les particules
const CAMERA_PUSH_STRENGTH = 9; // amplitude maximale de l'écartement au contact
const ACCENT_PROBABILITY = 0.05; // proportion de particules "dorées", rares
const ACCENT_COLOR = new THREE.Color(0xd8ad5c); // doré/cuivré, écho de l'accent de la toile
const PARTICLE_SIZE = 1.5; // taille de sprite (unités de scène ; atténuée avec la distance à la caméra)
const PARTICLE_OPACITY = 0.16; // volontairement subtil — un plus atmosphérique, pas un effet qui domine le décor
// Le blending additif sature vite vers le blanc sur un fond de ciel clair : on
// compense en gardant le sprite lui-même peu opaque (voir createSpriteTexture)
// plutôt qu'en comptant uniquement sur PARTICLE_OPACITY.
const VERTICAL_MARGIN = 3; // marge basse pour ne pas faire naître de particules dans le sol

// ---------- Bruit de Perlin 3D (implémentation classique, domaine public) ----------
// Pas de dépendance externe : juste ce qu'il faut pour une dérive organique.

const PERM = new Uint8Array(512);
(function initPermutation(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  function rand() {
    // xorshift32 — mélange déterministe, reproductible d'une session à l'autre
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})(1337);

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerpNum(a, b, t) {
  return a + t * (b - a);
}
function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin3(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  return lerpNum(
    lerpNum(
      lerpNum(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerpNum(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u),
      v
    ),
    lerpNum(
      lerpNum(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      lerpNum(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u),
      v
    ),
    w
  );
}

// ---------- Sprite en dégradé circulaire doux (pas de points nets) ----------

function createSpriteTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(255,255,255,0.5)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Crée le champ de particules pour un terrain donné.
 * @param {number} terrainSize - même taille que le terrain (voir heightmap.js)
 * @param {number} heightScale - hauteur max du relief, pour caler la bande verticale du nuage
 * @param {THREE.Color[]} paletteColors - [couleurCiel, couleurSol] du paysage courant
 * @returns {{ points: THREE.Points, update: (camera: THREE.Camera, delta: number, elapsed: number) => void, dispose: () => void }}
 */
export function createParticleField({ terrainSize, heightScale, paletteColors }) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const basePositions = new Float32Array(PARTICLE_COUNT * 3);
  const displacement = new Float32Array(PARTICLE_COUNT * 3);
  const seeds = new Float32Array(PARTICLE_COUNT);

  const halfSpan = (terrainSize / 2) * 0.92; // légèrement en retrait des bords du terrain
  const yMin = VERTICAL_MARGIN;
  const yMax = Math.max(yMin + 4, heightScale * 1.3);

  const c1 = paletteColors[0];
  const c2 = paletteColors[1] ?? paletteColors[0];
  const tmpColor = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const ix = i * 3;
    const x = (Math.random() * 2 - 1) * halfSpan;
    const y = yMin + Math.random() * (yMax - yMin);
    const z = (Math.random() * 2 - 1) * halfSpan;
    basePositions[ix] = positions[ix] = x;
    basePositions[ix + 1] = positions[ix + 1] = y;
    basePositions[ix + 2] = positions[ix + 2] = z;
    seeds[i] = Math.random() * 1000;

    if (Math.random() < ACCENT_PROBABILITY) {
      // Quelques particules dorées, rares et plus lumineuses — écho de
      // l'accent doré/cuivré ponctuel de la toile (pas une teinte dominante,
      // volontairement fixe plutôt qu'extraite : ce fin liseré est trop
      // étroit pour être capté fiablement par une moyenne de bande de pixels
      // comme le sont skyColor/groundColor).
      tmpColor.copy(ACCENT_COLOR);
      tmpColor.getHSL(hsl);
      hsl.h = (hsl.h + (Math.random() - 0.5) * 0.02 + 1) % 1;
      hsl.l = Math.min(1, hsl.l + Math.random() * 0.1);
      tmpColor.setHSL(hsl.h, hsl.s, hsl.l);
    } else {
      const t = Math.random();
      tmpColor.copy(c1).lerp(c2, t);
      tmpColor.getHSL(hsl);
      hsl.h = (hsl.h + (Math.random() - 0.5) * 0.04 + 1) % 1;
      hsl.s = Math.min(1, Math.max(0, hsl.s + (Math.random() - 0.5) * 0.15));
      hsl.l = Math.min(1, Math.max(0.08, hsl.l + (Math.random() - 0.5) * 0.12));
      tmpColor.setHSL(hsl.h, hsl.s, hsl.l);
    }
    colors[ix] = tmpColor.r;
    colors[ix + 1] = tmpColor.g;
    colors[ix + 2] = tmpColor.b;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const spriteTexture = createSpriteTexture();
  const material = new THREE.PointsMaterial({
    size: PARTICLE_SIZE,
    map: spriteTexture,
    vertexColors: true,
    transparent: true,
    opacity: PARTICLE_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: true, // se fond dans le brouillard existant plutôt que de se superposer par-dessus
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // le nuage couvre tout le trajet ; éviter un culling approximatif qui le ferait disparaître par erreur

  // Mise à jour étalée sur STAGGER_GROUPS frames : à chaque appel, seule une
  // fraction des particules recalcule sa position. Pour une dérive aussi
  // lente que la nôtre (DRIFT_SPEED), la différence est imperceptible, mais
  // ça divise le coût CPU par frame par STAGGER_GROUPS — nécessaire pour
  // rester fluide une fois combiné au rendu du terrain. Le delta utilisé
  // pour le lissage est multiplié en conséquence pour rester correct (une
  // particule traitée une frame sur deux "rattrape" un intervalle 2x plus
  // long).
  let frameParity = 0;

  function update(camera, delta, elapsed) {
    const posAttr = geometry.attributes.position;
    const arr = posAttr.array;
    const effectiveDelta = delta * STAGGER_GROUPS;
    const springFactor = 1 - Math.exp(-SPRING_RATE * effectiveDelta); // lissage stable, indépendant du framerate

    for (let i = frameParity; i < PARTICLE_COUNT; i += STAGGER_GROUPS) {
      const ix = i * 3;
      const iy = ix + 1;
      const iz = ix + 2;
      const bx = basePositions[ix];
      const by = basePositions[iy];
      const bz = basePositions[iz];
      const seed = seeds[i];

      const t = elapsed * DRIFT_SPEED + seed;
      // nx/nz : bruit de Perlin 3D (mouvement horizontal, le plus visible).
      // ny : dérive verticale volontairement moins coûteuse (simple somme de
      // sinus) — l'amplitude verticale est de toute façon réduite (x0.35),
      // un vrai bruit de Perlin n'y apporterait rien de perceptible.
      const nx = perlin3(bx * DRIFT_FREQUENCY + 17.1, by * DRIFT_FREQUENCY, t);
      const ny =
        (Math.sin(t * 1.7 + seed * 2.1) * 0.6 +
          Math.sin(bx * 0.02 + bz * 0.017 + t * 0.5) * 0.4) *
        0.35;
      const nz = perlin3(bx * DRIFT_FREQUENCY + 63.4, by * DRIFT_FREQUENCY, t + 29.6);

      let targetX = nx * DRIFT_AMPLITUDE;
      let targetY = ny * DRIFT_AMPLITUDE;
      let targetZ = nz * DRIFT_AMPLITUDE;

      // Écartement à l'approche de la caméra, basé sur la position affichée
      // à la frame précédente (donc la proximité réelle perçue à l'écran).
      const curX = arr[ix];
      const curY = arr[iy];
      const curZ = arr[iz];
      const dx = curX - camera.position.x;
      const dy = curY - camera.position.y;
      const dz = curZ - camera.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < CAMERA_PUSH_RADIUS && dist > 0.0001) {
        const strength =
          (1 - dist / CAMERA_PUSH_RADIUS) ** 2 * CAMERA_PUSH_STRENGTH;
        const inv = strength / dist;
        targetX += dx * inv;
        targetY += dy * inv;
        targetZ += dz * inv;
      }

      displacement[ix] += (targetX - displacement[ix]) * springFactor;
      displacement[iy] += (targetY - displacement[iy]) * springFactor;
      displacement[iz] += (targetZ - displacement[iz]) * springFactor;

      arr[ix] = bx + displacement[ix];
      arr[iy] = by + displacement[iy];
      arr[iz] = bz + displacement[iz];
    }
    frameParity = (frameParity + 1) % STAGGER_GROUPS;
    posAttr.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    spriteTexture.dispose();
  }

  return { points, update, dispose };
}
