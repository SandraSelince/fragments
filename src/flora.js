import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Champ de fleurs en VRAIE 3D : un modèle de plante (ici Leipoldtia schultzei,
 * Poly Haven, licence CC0) semé en centaines d'exemplaires sur le relief.
 *
 * - INSTANCIATION : un seul appel à la carte graphique par variante de touffe
 *   (grande / moyenne / petite), même avec des centaines d'exemplaires.
 * - MASSIFS : les plantes sont regroupées en taches, jamais sous l'eau, ni sur
 *   les pentes trop raides ni sur les sommets.
 * - VARIÉTÉ : taille, rotation et teinte différentes pour chaque exemplaire.
 * - VENT : les plantes ondulent, la base reste fixe, en vagues qui traversent le champ.
 *
 * Réglages par paysage dans landscapes.js, clé `flora` (voir FLORA_DEFAULTS).
 * Le modèle est allégé (de 385 000 à ~14 000 triangles pour les 3 touffes) ;
 * les textures sont dans public/flore/.
 */

export const FLORA_DEFAULTS = {
  model: "/flore/leipoldtia.glb",
  textures: {
    color: "/flore/leipoldtia_diff.webp",
    normal: "/flore/leipoldtia_nor.webp",
    arm: "/flore/leipoldtia_arm.webp", // AO / rugosité / métal
  },
  patches: 45, // nombre de massifs
  perPatch: 16, // touffes par massif
  patchRadius: 11, // rayon d'un massif (unités de scène)
  scale: [9, 16], // taille des touffes (min, max)
  maxSlope: 0.5, // inclinaison max du terrain (0 = plat, 1 = vertical)
  maxHeight: 0.5, // fraction de la hauteur max du relief au-dessus de laquelle on ne sème plus
  nearStart: 8, // massifs placés près du point de départ, pour les voir tout de suite
  wind: 1, // force du vent (0 = immobile)
  tint: 0.12, // variation de luminosité entre exemplaires
  glow: 0.45, // part de couleur propre (évite que les plantes paraissent sombres à contre-jour)
  alpha: true, // découpe la transparence (pétales) ; false pour des objets pleins comme des rochers
  sink: 0.02, // enfoncement dans le sol (fraction de la hauteur de l'objet)
  tilt: 0.08, // inclinaison aléatoire max (radians)
  minHeightAboveWater: 0.4, // distance min au-dessus de l'eau
};

const rand = (a, b) => a + Math.random() * (b - a);

export function createFlora({ config = {}, terrainSize, maxHeight, getHeightAt, waterLevel = -Infinity, waterAt = null, startZ }) {
  const C = { ...FLORA_DEFAULTS, ...config, textures: { ...FLORA_DEFAULTS.textures, ...(config.textures || {}) } };
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uWind: { value: C.wind } };
  let meshes = [];
  let disposed = false;

  // --- matériau partagé (PBR) + vent dans le vertex shader
  const tl = new THREE.TextureLoader();
  const loadTex = (url, srgb) => {
    const t = tl.load(url);
    t.flipY = false; // convention glTF
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const arm = loadTex(C.textures.arm, false);
  const material = new THREE.MeshStandardMaterial({
    map: loadTex(C.textures.color, true),
    normalMap: loadTex(C.textures.normal, false),
    roughnessMap: arm,
    aoMap: arm,
    metalness: 0,
    alphaTest: C.alpha ? 0.5 : 0,
    side: C.alpha ? THREE.DoubleSide : THREE.FrontSide,
  });
  // les couleurs de la plante (fleurs roses, feuilles vert tendre) restent lisibles même à l'ombre
  material.emissive = new THREE.Color(1, 1, 1).multiplyScalar(C.glow);
  material.emissiveMap = material.map;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hgt = max(transformed.y, 0.0);           // 0 au pied, plus haut = plus de mouvement
        float gust = sin(uTime * 0.6 + ip.x * 0.02 + ip.z * 0.015) * 0.5 + 0.5; // rafales qui traversent le champ
        float sway = sin(uTime * 1.7 + ip.x * 0.15 + ip.z * 0.11) + 0.4 * sin(uTime * 3.1 + ip.z * 0.3);
        transformed.x += sway * hgt * hgt * uWind * (0.6 + gust) * 1.6;
        transformed.z += cos(uTime * 1.3 + ip.x * 0.12) * hgt * hgt * uWind * 0.8;`
      );
  };

  // --- placement : centres de massifs valides
  const half = terrainSize / 2 - 15;
  const slopeAt = (x, z) => {
    const e = 2;
    const dx = (getHeightAt(x + e, z) - getHeightAt(x - e, z)) / (2 * e);
    const dz = (getHeightAt(x, z + e) - getHeightAt(x, z - e)) / (2 * e);
    return Math.min(1, Math.hypot(dx, dz)); // ~0 plat, ~1 très raide
  };
  const valid = (x, z) => {
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    const y = getHeightAt(x, z);
    const w = waterAt ? waterAt(x, z) : waterLevel;
    return y > w + C.minHeightAboveWater && y < maxHeight * C.maxHeight && slopeAt(x, z) < C.maxSlope;
  };
  const centers = [];
  for (let tries = 0; centers.length < C.nearStart && tries < 400; tries++) {
    const x = rand(-45, 45), z = startZ - rand(10, 70);
    if (valid(x, z)) centers.push([x, z]);
  }
  for (let tries = 0; centers.length < C.patches + C.nearStart && tries < 5000; tries++) {
    const x = rand(-half, half), z = rand(-half, half);
    if (valid(x, z)) centers.push([x, z]);
  }

  const spots = [];
  for (const [cx, cz] of centers) {
    const n = Math.round(C.perPatch * rand(0.6, 1.4));
    for (let i = 0; i < n; i++) {
      // distribution plus dense au centre du massif
      const r = C.patchRadius * Math.sqrt(Math.random()) * rand(0.3, 1);
      const a = Math.random() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (valid(x, z)) spots.push([x, z]);
    }
  }

  // --- chargement du modèle et création des instances
  new GLTFLoader().load(C.model, (gltf) => {
    if (disposed) return;
    gltf.scene.updateMatrixWorld(true);
    const variants = [];
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld); // intègre l'échelle du fichier
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      const h = b.max.y - b.min.y;
      geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y - Math.max(0.02, h * C.sink), -(b.min.z + b.max.z) / 2); // pied au sol, centré
      variants.push(geo);
    });
    if (!variants.length) return;

    // répartition des emplacements entre les variantes (petites touffes plus nombreuses)
    const buckets = variants.map(() => []);
    const weights = variants.length === 3 ? [0.3, 0.3, 0.4] : variants.map(() => 1 / variants.length);
    for (const s of spots) {
      let r = Math.random(), k = 0;
      while (k < weights.length - 1 && r > weights[k]) r -= weights[k++];
      buckets[k].push(s);
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    variants.forEach((geo, k) => {
      const list = buckets[k];
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach(([x, z], i) => {
        dummy.position.set(x, getHeightAt(x, z), z);
        dummy.rotation.set(rand(-C.tilt, C.tilt), Math.random() * Math.PI * 2, rand(-C.tilt, C.tilt));
        dummy.scale.setScalar(rand(C.scale[0], C.scale[1]));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // légère variation de teinte et de luminosité
        color.setHSL(0, 0, 1).offsetHSL(rand(-C.tint, C.tint) * 0.3, 0, rand(-C.tint, C.tint));
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes.push(mesh);
    });
  });

  return {
    group,
    count: spots.length,
    spots,
    update(camera, delta, elapsed) {
      uniforms.uTime.value = elapsed;
    },
    dispose() {
      disposed = true;
      meshes.forEach((m) => {
        m.geometry.dispose();
        m.dispose();
      });
      material.map?.dispose();
      material.normalMap?.dispose();
      arm.dispose();
      material.dispose();
    },
  };
}
