import * as THREE from "three";

/**
 * HORIZON INFINI : le terrain se prolonge au-delà de ses bords.
 *
 * Autour du terrain peint, une grande nappe reprend la peinture et le relief
 * EN MIROIR (comme si l'aquarelle était dépliée symétriquement tout autour) :
 * pas de raccord visible au bord, et le paysage continue jusqu'à se perdre
 * dans la brume. Plus on s'éloigne, plus le relief s'adoucit (flatten).
 *
 * Réglages : landscape.horizon = { extent, flatten, flattenDistance }
 *  - extent : jusqu'où va la nappe (unités de scène, la brume cache le reste)
 *  - flatten : relief gardé au loin (1 = identique, 0 = plat)
 *  - flattenDistance : distance au bord sur laquelle le relief s'adoucit
 */
export function createHorizon({ terrainSize, getHeightAt, material, extent = 1900, flatten = 0.55, flattenDistance = 500 }) {
  const half = terrainSize / 2;
  // pas de grille calé sur le terrain : des sommets tombent pile sur le bord
  const cell = half / 16;
  const segs = Math.round((extent * 2) / cell);
  const size = segs * cell;
  const geometry = new THREE.PlaneGeometry(size, size, segs, segs);
  geometry.rotateX(-Math.PI / 2);

  // repli en miroir dans [-half, half]
  const mirror = (v) => {
    const p = 4 * half;
    let m = (((v + half) % p) + p) % p;
    if (m > 2 * half) m = p - m;
    return m - half;
  };

  // point le plus bas du terrain : sous le terrain, la nappe est enfouie
  let minH = Infinity;
  for (let i = 0; i <= 32; i++)
    for (let j = 0; j <= 32; j++) minH = Math.min(minH, getHeightAt(-half + (i / 32) * terrainSize, -half + (j / 32) * terrainSize));
  const buried = minH - 30;

  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const eps = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const outside = Math.max(Math.abs(x), Math.abs(z)) - half; // distance au bord (négatif = dedans)
    const mx = mirror(x);
    const mz = mirror(z);
    let y;
    if (outside < -eps) {
      y = buried; // caché sous le terrain peint
    } else {
      const h = getHeightAt(mx, mz);
      const t = THREE.MathUtils.smoothstep(outside, 0, flattenDistance);
      y = THREE.MathUtils.lerp(h, minH + (h - minH) * flatten, t);
    }
    pos.setY(i, y);
    // même placage que le terrain (u de gauche à droite, v de bas en haut) ; la texture est répétée en miroir
    uv.setXY(i, x / terrainSize + 0.5, 0.5 - z / terrainSize);
  }
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = false;

  return {
    object: mesh,
    dispose() {
      geometry.dispose(); // le matériau est celui du terrain : libéré avec lui
    },
  };
}
