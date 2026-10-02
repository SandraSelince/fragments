import * as THREE from "three";

/**
 * Montagnes lointaines : une bande de l'aquarelle (crêtes bleues, ciel rendu
 * transparent) enroulée sur un grand cylindre qui suit la caméra. Elles restent
 * donc toujours à l'horizon, très loin, quelle que soit la promenade.
 *
 * Réglages : landscape.backdrop = { image, height, elevation, repeat, tint, haze }
 */
export function createBackdrop({ image, height = 120, elevation = -8, repeat = 3, radius = 900, haze = 0.25, hazeColor }) {
  const tex = new THREE.TextureLoader().load(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.repeat.set(repeat, 1);
  tex.anisotropy = 4;

  const geo = new THREE.CylinderGeometry(radius, radius, height, 128, 1, true);
  geo.translate(0, height / 2, 0);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false, // trop loin pour le brouillard : on applique une brume légère à la main
    color: new THREE.Color(1, 1, 1).lerp(hazeColor || new THREE.Color(1, 1, 1), haze),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;

  return {
    object: mesh,
    update(camera) {
      // suit la caméra : l'horizon ne se rapproche jamais
      mesh.position.set(camera.position.x, camera.position.y + elevation, camera.position.z);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
