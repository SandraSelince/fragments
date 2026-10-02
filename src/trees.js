import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Arbres "peints" : silhouettes simples (tronc + houppier en plusieurs boules
 * irrégulières), facettes douces, couleurs tirées de la palette de l'aquarelle.
 * Instanciés (des centaines d'arbres pour très peu de calcul) et regroupés en
 * bosquets avec des clairières. Les houppiers se balancent légèrement au vent.
 *
 * Réglages par paysage dans landscapes.js, clé `trees` (voir TREE_DEFAULTS).
 */
export const TREE_DEFAULTS = {
  groves: 40, // nombre de bosquets
  perGrove: 9, // arbres par bosquet (en moyenne)
  groveRadius: 22,
  height: [9, 18], // hauteur des arbres
  maxSlope: 0.7,
  maxHeight: 0.85, // fraction de la hauteur du relief au-dessus de laquelle il n'y a plus d'arbres
  clearing: 22, // rayon sans arbres autour du point de départ
  colors: ["#2b6a63", "#3f8a63", "#2aa596", "#8e3a52", "#7a3340", "#9a9a3a", "#5a8a3a", "#c9506a"],
  trunk: "#3a2622",
  wind: 1,
  unlit: 0.55, // part de la couleur affichée telle quelle (sinon les arbres à contre-jour deviennent noirs)
};

const rand = (a, b) => a + Math.random() * (b - a);

function canopyGeometry(seed) {
  const parts = [];
  const blobs = 6 + Math.floor(seed * 5); // plusieurs petites touffes = silhouette plus découpée
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(rand(0.22, 0.42), 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, k);
      v.multiplyScalar(1 + (Math.sin(v.x * 9 + seed * 20) + Math.cos(v.y * 7 + v.z * 5)) * 0.08);
      p.setXYZ(k, v.x, v.y, v.z);
    }
    g.translate(rand(-0.45, 0.45), 0.95 + rand(-0.2, 0.55), rand(-0.45, 0.45));
    parts.push(g.toNonIndexed());
  }
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

export function createTrees({ config = {}, terrainSize, maxHeight, getHeightAt, waterAt = () => -Infinity, startZ }) {
  const C = { ...TREE_DEFAULTS, ...config };
  const group = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uWind: { value: C.wind } };

  // placement
  const half = terrainSize / 2 - 10;
  const slopeAt = (x, z) => {
    const e = 2;
    return Math.min(1, Math.hypot(getHeightAt(x + e, z) - getHeightAt(x - e, z), getHeightAt(x, z + e) - getHeightAt(x, z - e)) / (2 * e));
  };
  const valid = (x, z) => {
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (Math.hypot(x, z - startZ) < C.clearing) return false;
    const y = getHeightAt(x, z);
    return y > waterAt(x, z) + 0.5 && y < maxHeight * C.maxHeight && slopeAt(x, z) < C.maxSlope;
  };
  const spots = [];
  for (let g = 0, tries = 0; g < C.groves && tries < 4000; tries++) {
    const cx = rand(-half, half), cz = rand(-half, half);
    if (!valid(cx, cz)) continue;
    g++;
    const n = Math.round(C.perGrove * rand(0.5, 1.6));
    for (let i = 0; i < n; i++) {
      const r = C.groveRadius * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (valid(x, z)) spots.push([x, z]);
    }
  }

  // géométries : 3 formes de houppier, un tronc
  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.11, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const canopies = [0.1, 0.5, 0.9].map(canopyGeometry);

  const trunkMat = new THREE.MeshLambertMaterial({ color: C.trunk });
  const canopyMat = new THREE.MeshLambertMaterial({ flatShading: true });
  canopyMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;\nvarying float vTreeY;\nvarying vec3 vTreeWorld;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        vTreeY = transformed.y;
        vTreeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        float sway = sin(uTime * 0.9 + ip.x * 0.05 + ip.z * 0.04) * 0.06 * uWind * max(transformed.y - 0.6, 0.0);
        transformed.x += sway;
        transformed.z += sway * 0.5;`
      );
    shader.uniforms.uUnlit = { value: C.unlit };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uUnlit;
        varying float vTreeY;
        varying vec3 vTreeWorld;
        float tHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float tNoise(vec3 x) {
          vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(tHash(i), tHash(i + vec3(1,0,0)), f.x), mix(tHash(i + vec3(0,1,0)), tHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(tHash(i + vec3(0,0,1)), tHash(i + vec3(1,0,1)), f.x), mix(tHash(i + vec3(0,1,1)), tHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`
      )
      .replace(
        "#include <color_fragment>",
        // aspect aquarelle : houppier plus sombre en bas, plus clair en haut, et taches irrégulières
        `#include <color_fragment>
        float wash = tNoise(vTreeWorld * 0.35) * 0.6 + tNoise(vTreeWorld * 1.3) * 0.4;
        diffuseColor.rgb *= mix(0.6, 1.2, smoothstep(0.55, 1.5, vTreeY)) * (0.78 + 0.45 * wash);`
      )
      .replace(
        "#include <opaque_fragment>",
        // couleur propre + léger dégradé : plus clair en haut du houppier
        "outgoingLight = mix(outgoingLight, diffuseColor.rgb, uUnlit);\n#include <opaque_fragment>"
      );
  };

  const palette = C.colors.map((c) => new THREE.Color(c));
  const buckets = canopies.map(() => []);
  spots.forEach((s) => buckets[Math.floor(Math.random() * canopies.length)].push(s));

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  let t = 0;
  const meshes = [trunks];
  canopies.forEach((geo, k) => {
    const list = buckets[k];
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geo, canopyMat, list.length);
    list.forEach(([x, z], i) => {
      const h = rand(C.height[0], C.height[1]);
      const w = h * rand(0.55, 0.85);
      const y = getHeightAt(x, z) - 0.3;
      const ry = Math.random() * Math.PI * 2;
      dummy.position.set(x, y, z);
      dummy.rotation.set(rand(-0.05, 0.05), ry, rand(-0.05, 0.05));
      dummy.scale.set(w, h * 0.62, w);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.copy(palette[Math.floor(Math.random() * palette.length)]).offsetHSL(rand(-0.02, 0.02), 0, rand(-0.06, 0.06));
      mesh.setColorAt(i, col);
      // tronc
      dummy.scale.set(h * 0.9, h * 0.62, h * 0.9);
      dummy.updateMatrix();
      trunks.setMatrixAt(t++, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    meshes.push(mesh);
  });
  trunks.count = t;
  trunks.instanceMatrix.needsUpdate = true;
  meshes.forEach((m) => {
    m.frustumCulled = false;
    group.add(m);
  });

  return {
    group,
    count: spots.length,
    update(camera, delta, elapsed) {
      uniforms.uTime.value = elapsed;
    },
    dispose() {
      meshes.forEach((m) => m.dispose());
      trunkGeo.dispose();
      canopies.forEach((g) => g.dispose());
      trunkMat.dispose();
      canopyMat.dispose();
    },
  };
}
