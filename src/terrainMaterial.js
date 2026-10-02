import * as THREE from "three";

/**
 * Matériau du terrain : la peinture reste la base, et les fragments de collage
 * sont posés par-dessus selon la zone du relief, comme des papiers déchirés
 * collés sur la montagne.
 *
 * Zones possibles pour chaque fragment (voir landscapes.js) :
 *  - "bas"     : fonds de vallée, plaines
 *  - "pentes"  : flancs raides (dépend de l'inclinaison, pas de la hauteur)
 *  - "sommets" : crêtes et hauteurs
 *
 * Réglages par fragment :
 *  - tile     : taille d'une répétition du fragment, en unités de scène
 *               (petit = motif serré, grand = fragment étalé)
 *  - strength : 0 = invisible, 1 = recouvre totalement la peinture
 *
 * Les zones transparentes des PNG (bords déchirés) laissent voir la peinture
 * dessous. Les frontières entre zones sont "déchirées" par un bruit pour ne pas
 * faire de lignes droites. La projection est triplanaire : les fragments ne
 * s'étirent pas sur les pentes raides.
 */

const ZONES = { bas: 0, pentes: 1, sommets: 2 };

export function createTerrainMaterial({ texture, fragments = [], maxHeight, saturation = 1, unlit = 0.5 }) {
  const loader = new THREE.TextureLoader();
  const slots = [0, 1, 2].map((k) => fragments.find((f) => ZONES[f.zone] === k));

  const makeTex = (f) => {
    if (!f) return null;
    const t = loader.load(f.image);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; // raccords sans couture visible
    t.anisotropy = 8;
    return t;
  };
  const textures = slots.map(makeTex);
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;

  const uniforms = {
    uFrag0: { value: textures[0] || blank },
    uFrag1: { value: textures[1] || blank },
    uFrag2: { value: textures[2] || blank },
    uTile: { value: new THREE.Vector3(...slots.map((f) => f?.tile ?? 60)) },
    uStrength: { value: new THREE.Vector3(...slots.map((f) => (f ? f.strength ?? 0.9 : 0))) },
    uMaxHeight: { value: maxHeight },
    uSaturation: { value: saturation },
    uUnlit: { value: unlit },
  };

  const material = new THREE.MeshLambertMaterial({ map: texture });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vTerrainPos;
        varying vec3 vTerrainNormal;
        uniform sampler2D uFrag0;
        uniform sampler2D uFrag1;
        uniform sampler2D uFrag2;
        uniform vec3 uTile;
        uniform vec3 uStrength;
        uniform float uMaxHeight;
        uniform float uSaturation;
        uniform float uUnlit;

        float tHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
        }
        // échantillonnage triplanaire : projette le fragment depuis les 3 axes et mélange selon la normale
        vec4 triplanar(sampler2D tex, vec3 p, vec3 n, float tile) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec4 xz = texture2D(tex, p.xz / tile);
          vec4 xy = texture2D(tex, vec2(p.x, -p.y) / tile);
          vec4 zy = texture2D(tex, vec2(p.z, -p.y) / tile);
          return xz * w.y + xy * w.z + zy * w.x;
        }`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec3 n = normalize(vTerrainNormal);
          // hauteur normalisée, "déchirée" par du bruit pour des frontières irrégulières
          float torn = (tNoise(vTerrainPos.xz * 0.035) - 0.5) * 0.22 + (tNoise(vTerrainPos.xz * 0.15) - 0.5) * 0.08;
          float h = clamp(vTerrainPos.y / uMaxHeight, 0.0, 1.0) + torn;
          float slope = 1.0 - n.y;

          float wSommets = smoothstep(0.5, 0.62, h);
          float wBas = 1.0 - smoothstep(0.14, 0.26, h);
          float wPentes = smoothstep(0.1, 0.24, slope + torn * 0.5) * (1.0 - wSommets) * (1.0 - wBas * 0.7);

          vec4 f0 = triplanar(uFrag0, vTerrainPos, n, uTile.x);
          vec4 f1 = triplanar(uFrag1, vTerrainPos, n, uTile.y);
          vec4 f2 = triplanar(uFrag2, vTerrainPos, n, uTile.z);

          diffuseColor.rgb = mix(diffuseColor.rgb, f0.rgb, f0.a * wBas * uStrength.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, f1.rgb, f1.a * wPentes * uStrength.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, f2.rgb, f2.a * wSommets * uStrength.z);

          // saturation : 1 = couleurs d'origine, >1 = plus vives, <1 = plus ternes
          float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = max(mix(vec3(grey), diffuseColor.rgb, uSaturation), 0.0);
        }`
      )
      // "unlit" : part de la couleur de la peinture affichée telle quelle, sans ombre ni lumière
      // (0 = éclairage 3D complet, 1 = couleurs exactes de la toile partout)
      .replace(
        "#include <opaque_fragment>",
        "outgoingLight = mix(outgoingLight, diffuseColor.rgb, uUnlit);\n#include <opaque_fragment>"
      );
  };

  material.userData.fragmentTextures = textures.filter(Boolean);
  return material;
}
