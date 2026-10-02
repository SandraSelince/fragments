import * as THREE from "three";

/**
 * Construit un terrain à partir d'une image de peinture : par défaut, la
 * même image sert à la fois de heightmap (relief) et de texture (couleur
 * plaquée sur le relief), pour donner l'impression d'avoir extrudé la toile
 * en 3D. Une carte de profondeur séparée peut aussi être fournie (option
 * `depthUrl`) pour piloter le relief indépendamment de la couleur — voir
 * "Mode carte de profondeur séparée" plus bas.
 *
 * ---- Comment le relief est calculé (mode par défaut, sans depthUrl) ----
 * 1. L'image est dessinée dans un <canvas> hors écran, ce qui permet de lire
 *    la couleur de chaque pixel (ctx.getImageData).
 * 2. Le terrain est un THREE.PlaneGeometry subdivisé en une grille de
 *    (SEGMENTS x SEGMENTS) — chaque sommet de cette grille correspond à un
 *    point (u, v) dans l'image, indépendamment de la résolution réelle du
 *    fichier source (u,v vont de 0 à 1, puis sont reconvertis en pixel via
 *    Math.floor(u * largeurImage)).
 * 3. Pour chaque sommet, on calcule la LUMINANCE du pixel correspondant
 *    (luminance = 0.299*R + 0.587*G + 0.114*B, la formule standard qui
 *    pondère la perception humaine — le vert compte plus que le bleu).
 * 4. Cette luminance (0 = noir, 1 = blanc) est convertie en hauteur :
 *       hauteur = luminance * HEIGHT_SCALE     (si invertHeight = false)
 *       hauteur = (1 - luminance) * HEIGHT_SCALE  (si invertHeight = true)
 *
 * ---- Mode carte de profondeur séparée (option depthUrl) ----------------
 * Si `depthUrl` est fourni (ex. un depth map généré par un modèle d'IA à
 * partir de la toile), la LUMINANCE utilisée à l'étape 3 ci-dessus vient de
 * cette image séparée au lieu de l'image couleur — la texture plaquée sur
 * le relief reste toujours l'image couleur. Les deux images doivent être
 * cadrées de façon identique (mêmes proportions, même recadrage) pour que
 * le relief corresponde bien à ce que montre la couleur à chaque point.
 * Un depth map "distance réelle" a souvent la convention inverse d'une
 * simple luminance de peinture (proche = clair), d'où l'option
 * `invertHeight` par appel plutôt qu'une seule constante globale.
 *
 * ---- Réglages pour Sandra ---------------------------------------------
 * - invertHeight (passé à buildTerrainFromImage, voir plus bas) : `false` =
 *   les zones CLAIRES de la source de relief deviennent des COLLINES
 *   (points hauts), les zones sombres des creux. Passer à `true` inverse le
 *   sens — utile si une toile a ses zones de matière/relief peint dans les
 *   tons sombres, ou si un depth map encode "clair = proche de la caméra"
 *   plutôt que "clair = loin/haut".
 * - HEIGHT_SCALE : hauteur maximale du relief en unités de scène. Plus la
 *   valeur est grande, plus le terrain est accidenté. 0 = terrain plat.
 * - HEIGHT_BLUR_RADIUS : lisse la heightmap en moyennant les pixels voisins
 *   avant de calculer la hauteur, pour éviter un relief "hérissé" à cause du
 *   grain/bruit d'une vraie photo scannée. 0 = pas de lissage (utile sur les
 *   placeholders, déjà lisses). Augmenter à 2-4 sur une photo haute
 *   résolution bruitée.
 * -------------------------------------------------------------------------
 */

const SEGMENTS = 256; // résolution de la grille du terrain (256x256 sommets) — plus fin pour des crêtes nettes
const TERRAIN_SIZE = 400; // taille du terrain en unités de scène (largeur = profondeur)
const HEIGHT_SCALE = 70; // hauteur max du relief "de base" (avant crêtes et bords), surchargeable par paysage

// ---- Réglages du relief (surchargeables par paysage via `relief: {...}` dans landscapes.js)
// heightScale : hauteur max du relief tiré de l'image.
// curve       : >1 creuse les vallées et pointe les sommets (1 = linéaire).
// ridges      : quantité de crêtes/détails rocheux ajoutés (0 = aucun).
// edgeRise    : remonte les bords gauche/droite/fond en montagnes qui ferment la vallée (0 = aucun).
// perspective   : 0 = relief 100 % tiré de l'image ; 1 = relief qui suit la perspective du tableau
//                 (bas de l'image = proche et plat, haut = lointain et haut), l'image n'ajoute que du détail.
//                 Utile pour une aquarelle dont le clair/foncé ne correspond pas au relief (ciel clair, etc.).
// smooth        : lissage du relief (multiplie HEIGHT_BLUR_RADIUS), plus grand = collines plus douces.
const RELIEF_DEFAULTS = { heightScale: HEIGHT_SCALE, curve: 1.8, ridges: 0.35, edgeRise: 0.9, perspective: 0, smooth: 1 };

// Bruit "value noise" + fBm "ridged" : ajoute des arêtes montagneuses que la
// seule luminance d'une peinture (très lisse) ne peut pas donner.
function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function ridgedFbm(x, y) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < 5; o++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm; // 0..1
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const DEFAULT_INVERT_HEIGHT = false; // valeur par défaut, peut être surchargée par landscape (voir landscapes.js)
const HEIGHT_BLUR_RADIUS = 8; // lisse le grain d'une vraie photo de toile scannée (voir README)

const MAX_CANVAS_DIM = 4096; // était 1536 : on garde la résolution des images (limite pour les très grandes photos)

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function imageToCanvas(img) {
  const scale = Math.min(1, MAX_CANVAS_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function loadImageData(url) {
  const img = await loadImage(url);
  const canvas = imageToCanvas(img);
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, data, width: canvas.width, height: canvas.height };
}

function luminanceAt(data, width, height, px, py, radius = HEIGHT_BLUR_RADIUS) {
  const HEIGHT_BLUR_RADIUS_ = radius;
  if (HEIGHT_BLUR_RADIUS_ <= 0) {
    const i = (py * width + px) * 4;
    return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  }

  let sum = 0;
  let count = 0;
  const step = Math.max(1, Math.round(HEIGHT_BLUR_RADIUS_ / 8)); // échantillonnage clairsemé pour les grands rayons
  for (let dy = -HEIGHT_BLUR_RADIUS_; dy <= HEIGHT_BLUR_RADIUS_; dy += step) {
    for (let dx = -HEIGHT_BLUR_RADIUS_; dx <= HEIGHT_BLUR_RADIUS_; dx += step) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const i = (y * width + x) * 4;
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      count++;
    }
  }
  return sum / count / 255;
}

// Couleur de "ciel" utilisée pour le brouillard et le fond de scène :
// moyenne des pixels de la bande la plus haute de l'image (les premiers 10%
// de lignes), là où une peinture de paysage par bandes place le ciel.
function extractSkyColor(data, width, height) {
  const bandHeight = Math.max(1, Math.round(height * 0.1));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = 0; y < bandHeight; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  return new THREE.Color(r / count / 255, g / count / 255, b / count / 255);
}

// Même principe qu'extractSkyColor mais sur la bande la plus basse de
// l'image (le "premier plan"/sol dans une peinture par bandes). Sert de
// second point d'ancrage de palette pour le système de particules
// (voir particles.js) : interpoler entre ciel et sol donne des couleurs de
// poussière cohérentes avec la toile, sans avoir à échantillonner l'image
// pixel par pixel pour chaque particule.
function extractGroundColor(data, width, height) {
  const bandHeight = Math.max(1, Math.round(height * 0.1));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = height - bandHeight; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  return new THREE.Color(r / count / 255, g / count / 255, b / count / 255);
}

/**
 * Charge une image et construit le terrain : géométrie, texture, couleurs de
 * palette (ciel/sol) et fonction d'échantillonnage de hauteur.
 * getHeightAt(x, z) renvoie la hauteur du terrain (interpolée) à une position
 * du monde — utilisé pour faire "marcher" la caméra sur le relief plutôt que
 * de le laisser flotter ou traverser le sol. skyColor/groundColor et
 * heightScale/terrainSize sont réutilisés par le système de particules
 * (voir particles.js) pour rester visuellement cohérent avec ce terrain.
 */
export async function buildTerrainFromImage(url, { depthUrl, invertHeight, relief = {}, lake = null } = {}) {
  const R = { ...RELIEF_DEFAULTS, ...relief };
  const color = await loadImageData(url);
  // Source du relief : la carte de profondeur séparée si elle est fournie,
  // sinon l'image couleur elle-même (comportement par défaut d'origine).
  const depth = depthUrl ? await loadImageData(depthUrl) : color;
  const invert = invertHeight ?? DEFAULT_INVERT_HEIGHT;

  const imgWidth = color.width;
  const imgHeight = color.height;
  const data = color.data;

  const gridSize = SEGMENTS + 1;
  const heights = new Float32Array(gridSize * gridSize);

  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    SEGMENTS,
    SEGMENTS
  );
  geometry.rotateX(-Math.PI / 2); // plan vertical par défaut -> horizontal (Y = hauteur)

  const positions = geometry.attributes.position;

  const blurRadius = Math.round(HEIGHT_BLUR_RADIUS * R.smooth * Math.max(1, depth.width / 1536));

  // Passe 1 : luminance brute de la source de relief (image ou depth map).
  const raw = new Float32Array(gridSize * gridSize);
  let minL = Infinity;
  let maxL = -Infinity;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      // row=0 (v=0) = HAUT de l'image (fond de la promenade), row=SEGMENTS = BAS (premier plan, départ caméra).
      const u = col / SEGMENTS;
      const v = row / SEGMENTS;
      const dpx = Math.min(depth.width - 1, Math.floor(u * depth.width));
      const dpy = Math.min(depth.height - 1, Math.floor(v * depth.height));
      const lum = luminanceAt(depth.data, depth.width, depth.height, dpx, dpy, blurRadius);
      const val = invert ? 1 - lum : lum;
      raw[row * gridSize + col] = val;
      if (val < minL) minL = val;
      if (val > maxL) maxL = val;
    }
  }

  // Passe 2 : relief amplifié.
  // - normalisation : la luminance d'une peinture n'occupe souvent qu'une petite plage
  //   (ex. 0.35-0.6) ; on l'étire sur 0-1 pour utiliser toute la hauteur disponible ;
  // - courbe : vallées plus plates, sommets plus pointus ;
  // - crêtes : bruit ridged, plus fort sur les hauteurs que dans les vallées ;
  // - bords : montagnes qui ferment la vallée sur les côtés et au fond.
  const range = Math.max(1e-5, maxL - minL);
  let maxHeight = 0;
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const u = col / SEGMENTS;
      const v = row / SEGMENTS;
      const i = row * gridSize + col;
      // Math.max : raw est en Float32, un arrondi peut donner un tout petit négatif -> pow() = NaN
      const fromImage = Math.max(0, (raw[i] - minL) / range);
      const fromPerspective = 1 - v; // v=1 : bas du tableau (premier plan) ; v=0 : haut (lointain)
      const mixed = fromPerspective * R.perspective + fromImage * (1 - R.perspective * 0.75);
      const base = Math.pow(Math.max(0, mixed / (R.perspective + (1 - R.perspective * 0.75))), R.curve);
      const ridge = ridgedFbm(u * 6, v * 6) * R.ridges * (0.25 + 0.75 * base);
      const side = smoothstep(0.55, 1.0, Math.abs(u - 0.5) * 2);
      const back = smoothstep(0.45, 1.0, 1 - v);
      const rim = Math.max(side, back) * R.edgeRise * (0.6 + 0.4 * ridgedFbm(u * 3 + 11, v * 3 + 7));
      const height = (base + ridge + rim) * R.heightScale;
      positions.setY(i, height);
      heights[i] = height;
      if (height > maxHeight) maxHeight = height;
    }
  }
  // ---- Lac (option `lake` du paysage) : on creuse une cuvette douce, et le niveau
  // de l'eau est calé un peu sous la hauteur moyenne de ses rives.
  let lakeInfo = null;
  if (lake) {
    const half = TERRAIN_SIZE / 2;
    const toGrid = (w) => Math.round(((w + half) / TERRAIN_SIZE) * SEGMENTS);
    let rim = 0;
    const N = 48;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const gx = Math.min(SEGMENTS, Math.max(0, toGrid(lake.x + Math.cos(a) * lake.radius)));
      const gz = Math.min(SEGMENTS, Math.max(0, toGrid(lake.z + Math.sin(a) * lake.radius * (lake.stretch ?? 1))));
      rim += heights[gz * gridSize + gx];
    }
    rim /= N;
    const depth = lake.depth ?? 6;
    const level = rim - (lake.margin ?? 1.2);
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const i = row * gridSize + col;
        const wx = (col / SEGMENTS) * TERRAIN_SIZE - half;
        const wz = (row / SEGMENTS) * TERRAIN_SIZE - half;
        // distance normalisée (ovale) avec un bord légèrement irrégulier
        const ang = Math.atan2(wz - lake.z, wx - lake.x);
        const wobble = 1 + 0.12 * Math.sin(ang * 3 + 1.3) + 0.06 * Math.sin(ang * 7);
        const d = Math.hypot(wx - lake.x, (wz - lake.z) / (lake.stretch ?? 1)) / (lake.radius * wobble);
        if (d >= 1.35) continue;
        const bowl = level - depth * Math.max(0, 1 - d * d); // fond de la cuvette
        const blend = smoothstep(0.75, 1.35, d); // fondu vers le terrain d'origine
        const target = Math.min(heights[i], bowl + (rim - level) * smoothstep(0.85, 1.0, d) * 1.4);
        const h = target * (1 - blend) + heights[i] * blend;
        heights[i] = h;
        positions.setY(i, h);
      }
    }
    lakeInfo = { x: lake.x, z: lake.z, radius: lake.radius * 1.4, stretch: lake.stretch ?? 1, level };
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const texture = new THREE.CanvasTexture(color.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const skyColor = extractSkyColor(data, imgWidth, imgHeight);
  const groundColor = extractGroundColor(data, imgWidth, imgHeight);

  function getHeightAt(x, z) {
    // x,z en coordonnées monde -> coordonnées de grille [0, SEGMENTS]
    const gx = ((x + TERRAIN_SIZE / 2) / TERRAIN_SIZE) * SEGMENTS;
    const gz = ((z + TERRAIN_SIZE / 2) / TERRAIN_SIZE) * SEGMENTS;
    const cx = Math.min(SEGMENTS - 1, Math.max(0, Math.floor(gx)));
    const cz = Math.min(SEGMENTS - 1, Math.max(0, Math.floor(gz)));
    const fx = gx - cx;
    const fz = gz - cz;

    const h00 = heights[cz * gridSize + cx];
    const h10 = heights[cz * gridSize + cx + 1];
    const h01 = heights[(cz + 1) * gridSize + cx];
    const h11 = heights[(cz + 1) * gridSize + cx + 1];

    const hx0 = h00 + (h10 - h00) * fx;
    const hx1 = h01 + (h11 - h01) * fx;
    return hx0 + (hx1 - hx0) * fz;
  }

  return {
    geometry,
    texture,
    skyColor,
    groundColor,
    getHeightAt,
    terrainSize: TERRAIN_SIZE,
    heightScale: maxHeight,
    lake: lakeInfo, // { x, z, radius, stretch, level } ou null
  };
}
