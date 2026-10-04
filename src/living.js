import * as THREE from "three";
import { LIGHT } from "./lightFx.js";

/**
 * Éléments vivants de la promenade — tout ce qui bouge dans le décor :
 *
 *  1. EAU    : un lac qui remplit les creux du relief, avec des vaguelettes
 *              animées, des reflets de ciel (plus forts en regardant loin) et
 *              des scintillements.
 *  2. OISEAUX : des vols en V qui tournent lentement au-dessus de la vallée,
 *              ailes battantes.
 *  3. PAPIERS : des morceaux de tes fragments de collage qui volent dans le
 *              vent autour de toi en tournoyant, comme des feuilles.
 *
 * Tout se règle par paysage dans landscapes.js, clé `living` :
 *   living: {
 *     water:  { level: 0.12, color: 0x2f7d7a },   // level = fraction de la hauteur max (0 = pas d'eau)
 *     birds:  14,                                 // nombre d'oiseaux (0 = aucun)
 *     papers: 36,                                 // nombre de papiers volants (0 = aucun)
 *     wind:   [6, -2],                            // direction/force du vent (x, z) en unités/seconde
 *   }
 */

const DEFAULTS = {
  water: { level: 0.12, color: 0x2f7d7a },
  birds: 14,
  papers: 36,
  wind: [6, -2],
};

// ---------------------------------------------------------------- EAU

const texLoader = new THREE.TextureLoader();

export function createWater({ terrainSize, level, color, skyColor, lake = null, texture = null, normalMap = null, extent = 1.6, texScale = 0.035, fogScale = 1, follow = 0 }) {
  // lac : un disque (ovale) posé dans la cuvette ; sinon : une grande nappe (mer)
  // extent : taille de la nappe par rapport au terrain (plus grand = l'eau va jusqu'à l'horizon)
  // follow : rayon d'un grand disque d'eau qui suit la caméra (le lac va jusqu'aux montagnes lointaines)
  const geometry = lake
    ? new THREE.CircleGeometry(lake.radius, 96)
    : follow > 0
      ? new THREE.CircleGeometry(follow, 128)
      : new THREE.PlaneGeometry(terrainSize * extent, terrainSize * extent, 1, 1);

  // texture d'eau optionnelle (couleur + normal map), répétée en miroir pour éviter les raccords
  const loadTex = (url, srgb) => {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const colorTex = texture ? loadTex(texture, true) : null;
  const normalTex = normalMap ? loadTex(normalMap, false) : null;
  geometry.rotateX(-Math.PI / 2);
  if (lake) {
    geometry.scale(1, 1, lake.stretch);
    geometry.translate(lake.x, 0, lake.z);
  }

  const material = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(color) },
        uSky: { value: skyColor.clone() },
        uCamPos: { value: new THREE.Vector3() },
        uTex: { value: colorTex },
        uNormal: { value: normalTex },
        uTexScale: { value: texScale },
        uFogScale: { value: fogScale },
        uSunDir: { value: LIGHT.sunDirection.clone() },
        uSunColor: { value: new THREE.Color(LIGHT.sunColor) },
      },
    ]),
    defines: { USE_WATER_TEX: colorTex ? 1 : 0, USE_WATER_NORMAL: normalTex ? 1 : 0 },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uCamPos;
      uniform sampler2D uTex, uNormal;
      uniform float uTexScale, uFogScale;
      uniform vec3 uSunDir, uSunColor;
      varying vec3 vWorld;

      float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float wNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
      }

      void main() {
        vec2 p = vWorld.xz * 0.08;
        // deux couches de vaguelettes qui glissent dans des directions différentes
        float n = wNoise(p + vec2(uTime * 0.06, uTime * 0.04)) * 0.6
                + wNoise(p * 2.7 - vec2(uTime * 0.09, -uTime * 0.05)) * 0.4;
        vec3 viewDir = normalize(uCamPos - vWorld);
        // effet de Fresnel : l'eau reflète le ciel quand on la regarde de loin, rasante
        float fresnel = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 2.5);
        vec3 col = mix(uDeep, uSky, clamp(fresnel * 0.45 + (n - 0.5) * 0.3, 0.0, 1.0)); // 0.45 : part du reflet de ciel
        #if USE_WATER_TEX
          // Eau "miroir" (comme le matériau du modèle : rugosité 0) :
          // la normal map fait onduler la surface, qui reflète le ciel et le soleil.
          vec2 tp = vWorld.xz * uTexScale;
          vec3 nSum = vec3(0.0);
          #if USE_WATER_NORMAL
            // trois couches de vaguelettes à des échelles et directions différentes
            vec3 n1 = texture2D(uNormal, tp * 1.1 + vec2(uTime * 0.020, uTime * 0.013)).xyz * 2.0 - 1.0;
            vec3 n2 = texture2D(uNormal, tp * 1.9 + vec2(-uTime * 0.017, uTime * 0.021)).xyz * 2.0 - 1.0;
            vec3 n3 = texture2D(uNormal, tp * 0.45 + vec2(uTime * 0.006, -uTime * 0.009)).xyz * 2.0 - 1.0;
            nSum = n1 + n2 + n3 * 1.5;
          #endif
          // grandes ondulations douces en plus (bruit), pour les reflets qui ondulent au loin
          float wa = wNoise(vWorld.xz * 0.05 + vec2(uTime * 0.15, 0.0)) - wNoise(vWorld.xz * 0.05 + vec2(0.0, uTime * 0.12));
          vec3 N = normalize(vec3(nSum.x * 1.3 + wa * 0.3, 1.0, nSum.y * 1.3 - wa * 0.2));

          vec3 V = normalize(uCamPos - vWorld);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          // ciel reflété : bleu en haut, lavande rosée vers l'horizon (comme la capture)
          vec3 zenith = vec3(0.32, 0.42, 0.74);
          vec3 horizon = mix(uSky, vec3(0.88, 0.78, 0.88), 0.65);
          vec3 skyR = mix(horizon, zenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
          // couleur de l'eau en profondeur : la texture du modèle
          vec3 deep = (texture2D(uTex, tp + N.xz * 0.03 + vec2(uTime * 0.004, uTime * 0.003)).rgb) * vec3(0.78, 0.8, 0.95);
          float NdV = clamp(dot(N, V), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - NdV, 4.0);
          col = mix(deep, skyR, clamp(fres * 1.15, 0.0, 1.0));
          // reflets du soleil
          float sunSpec = pow(max(dot(R, normalize(uSunDir)), 0.0), 180.0);
          float sunGlow = pow(max(dot(R, normalize(uSunDir)), 0.0), 12.0);
          col += uSunColor * (sunSpec * 2.2 + sunGlow * 0.15);
        #endif
        #if USE_WATER_TEX
          gl_FragColor = vec4(col, 1.0);
        #else
          // scintillements
          float glint = smoothstep(0.86, 1.0, wNoise(vWorld.xz * 0.55 + vec2(uTime * 0.35, -uTime * 0.2)));
          col += glint * 0.35 * (0.4 + fresnel);
          gl_FragColor = vec4(col, 0.9);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // brouillard (atténué avec uFogScale : l'eau texturée reste visible jusqu'aux montagnes)
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF * uFogScale);
        #endif
      }`,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = level;
  mesh.renderOrder = 1;

  return {
    object: mesh,
    update(camera, delta, elapsed) {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uCamPos.value.copy(camera.position);
      if (follow > 0 && !lake) mesh.position.set(camera.position.x, level, camera.position.z);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      colorTex?.dispose();
      normalTex?.dispose();
    },
  };
}

// ---------------------------------------------------------------- OISEAUX

function createBirds({ count, terrainSize, maxHeight, color }) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true });
  // une aile = un triangle ; l'avant de l'oiseau est vers -Z
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, -0.5, 0, 0, 0.5, 2.6, 0, 0.5], 3)
  );

  const birds = [];
  const perFlock = 7;
  const flocks = Math.max(1, Math.ceil(count / perFlock));
  for (let f = 0; f < flocks; f++) {
    const flock = {
      radius: terrainSize * (0.18 + Math.random() * 0.15),
      height: maxHeight * (0.45 + Math.random() * 0.25),
      speed: (0.05 + Math.random() * 0.04) * (Math.random() < 0.5 ? 1 : -1),
      phase: Math.random() * Math.PI * 2,
      cx: (Math.random() - 0.5) * terrainSize * 0.3,
      cz: (Math.random() - 0.5) * terrainSize * 0.3,
    };
    for (let i = 0; i < perFlock && birds.length < count; i++) {
      const bird = new THREE.Group();
      const right = new THREE.Mesh(wingGeo, material);
      const left = new THREE.Mesh(wingGeo, material);
      left.scale.x = -1;
      bird.add(right, left);
      const scale = 0.9 + Math.random() * 0.5;
      bird.scale.setScalar(scale);
      // formation en V : rang et côté
      const rank = Math.ceil(i / 2);
      const side = i === 0 ? 0 : i % 2 ? 1 : -1;
      birds.push({
        bird, right, left, flock,
        offset: new THREE.Vector3(side * rank * 4.5, (Math.random() - 0.5) * 2, rank * 4.5),
        flap: 7 + Math.random() * 3,
        flapPhase: Math.random() * Math.PI * 2,
      });
      group.add(bird);
    }
  }

  const tmp = new THREE.Vector3();
  return {
    object: group,
    update(camera, delta, elapsed) {
      for (const b of birds) {
        const fl = b.flock;
        const a = fl.phase + elapsed * fl.speed;
        const dir = Math.sign(fl.speed);
        // position du chef de file sur son cercle + direction de vol (tangente)
        const lx = fl.cx + Math.cos(a) * fl.radius;
        const lz = fl.cz + Math.sin(a) * fl.radius;
        const fx = -Math.sin(a) * dir;
        const fz = Math.cos(a) * dir;
        const heading = Math.atan2(-fx, -fz);
        tmp.copy(b.offset).applyAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
        b.bird.position.set(lx + tmp.x, fl.height + tmp.y + Math.sin(elapsed * 0.7 + b.flapPhase) * 1.5, lz + tmp.z);
        b.bird.rotation.set(0, heading, Math.sin(elapsed * 0.5 + b.flapPhase) * 0.15);
        // battement d'ailes, avec des pauses planées
        const glide = 0.5 + 0.5 * Math.sin(elapsed * 0.6 + b.flapPhase);
        const flap = Math.sin(elapsed * b.flap + b.flapPhase) * (0.15 + 0.55 * glide);
        b.right.rotation.z = flap;
        b.left.rotation.z = -flap;
      }
    },
    dispose() {
      wingGeo.dispose();
      material.dispose();
    },
  };
}

// ---------------------------------------------------------------- PAPIERS VOLANTS

function createPapers({ count, fragments, getHeightAt, wind }) {
  const group = new THREE.Group();
  if (!fragments.length || count <= 0) return { object: group, update() {}, dispose() {} };

  const loader = new THREE.TextureLoader();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const perKind = Math.ceil(count / fragments.length);
  const kinds = fragments.map((f) => {
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      fog: true,
    });
    const kind = { material, aspect: 1.5, mesh: new THREE.InstancedMesh(geometry, material, perKind) };
    material.map = loader.load(f.image, (t) => {
      kind.aspect = t.image.width / t.image.height;
    });
    material.map.colorSpace = THREE.SRGBColorSpace;
    kind.mesh.frustumCulled = false;
    group.add(kind.mesh);
    return kind;
  });

  const RADIUS = 70; // les papiers restent dans ce rayon autour de toi
  const papers = [];
  kinds.forEach((kind, k) => {
    for (let i = 0; i < perKind; i++) {
      papers.push({
        kind, index: i,
        pos: new THREE.Vector3(),
        size: 0.7 + Math.random() * 1.5,
        spin: new THREE.Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.2),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        phase: Math.random() * 100,
        lift: 2 + Math.random() * 18,
        born: false,
      });
    }
  });

  const dummy = new THREE.Object3D();
  function respawn(p, camera, upwind) {
    const ang = Math.random() * Math.PI * 2;
    const r = upwind ? RADIUS * (0.7 + Math.random() * 0.3) : Math.random() * RADIUS;
    let x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    if (upwind) {
      // réapparaît du côté d'où vient le vent
      const wl = Math.hypot(wind[0], wind[1]) || 1;
      x = -wind[0] / wl * r + (Math.random() - 0.5) * RADIUS;
      z = -wind[1] / wl * r + (Math.random() - 0.5) * RADIUS;
    }
    p.pos.set(camera.position.x + x, 0, camera.position.z + z);
    p.pos.y = getHeightAt(p.pos.x, p.pos.z) + p.lift;
    p.born = true;
  }

  return {
    object: group,
    update(camera, delta, elapsed) {
      for (const p of papers) {
        if (!p.born) respawn(p, camera, false);
        const t = elapsed + p.phase;
        // vent + tourbillons (le papier "flotte" puis retombe doucement)
        p.pos.x += (wind[0] + Math.sin(t * 0.7) * 2.5) * delta;
        p.pos.z += (wind[1] + Math.cos(t * 0.53) * 2.5) * delta;
        const ground = getHeightAt(p.pos.x, p.pos.z);
        const targetY = ground + p.lift + Math.sin(t * 0.9) * 3;
        p.pos.y += (targetY - p.pos.y) * Math.min(1, delta * 0.8);
        if (Math.hypot(p.pos.x - camera.position.x, p.pos.z - camera.position.z) > RADIUS) respawn(p, camera, true);

        p.rot.x += p.spin.x * delta;
        p.rot.y += p.spin.y * delta;
        p.rot.z = Math.sin(t * 1.3) * 0.8;
        dummy.position.copy(p.pos);
        dummy.rotation.copy(p.rot);
        dummy.scale.set(p.size * p.kind.aspect, p.size, 1);
        dummy.updateMatrix();
        p.kind.mesh.setMatrixAt(p.index, dummy.matrix);
      }
      kinds.forEach((k) => (k.mesh.instanceMatrix.needsUpdate = true));
    },
    dispose() {
      geometry.dispose();
      kinds.forEach((k) => {
        k.material.map?.dispose();
        k.material.dispose();
        k.mesh.dispose();
      });
    },
  };
}

// ---------------------------------------------------------------- ASSEMBLAGE

export function createLivingElements({ living = {}, terrainSize, maxHeight, skyColor, fragments = [], getHeightAt, lake = null, density = {} }) {
  const cfg = { ...DEFAULTS, ...living, water: { ...DEFAULTS.water, ...(living.water || {}) } };
  // téléphone : moins de papiers volants et d'oiseaux (voir device.js)
  cfg.papers = Math.round(cfg.papers * (density.papers ?? 1));
  cfg.birds = Math.round(cfg.birds * (density.birds ?? 1));
  const group = new THREE.Group();
  const parts = [];

  // avec un lac : l'eau n'existe que dans la cuvette ; sinon nappe globale (level)
  const waterLevel = lake ? lake.level : cfg.water.level > 0 ? cfg.water.level * maxHeight : -Infinity;
  if (lake || cfg.water.level > 0) {
    const w = cfg.water;
    parts.push(
      createWater({
        terrainSize, level: waterLevel, color: w.color, skyColor, lake,
        texture: w.texture, normalMap: w.normalMap, extent: w.extent, texScale: w.texScale, fogScale: w.fogScale, follow: w.follow,
      })
    );
  }
  // hauteur de l'eau à un endroit donné (-Infinity hors du lac)
  const waterAt = (x, z) => {
    if (!lake) return waterLevel;
    const d = Math.hypot(x - lake.x, (z - lake.z) / lake.stretch);
    return d < lake.radius ? waterLevel : -Infinity;
  };
  if (cfg.birds > 0) {
    const birdColor = skyColor.clone().multiplyScalar(0.25);
    parts.push(createBirds({ count: cfg.birds, terrainSize, maxHeight, color: birdColor }));
  }
  if (cfg.papers > 0) {
    parts.push(createPapers({ count: cfg.papers, fragments, getHeightAt, wind: cfg.wind }));
  }
  parts.forEach((p) => group.add(p.object));

  return {
    group,
    waterLevel,
    waterAt,
    update(camera, delta, elapsed) {
      parts.forEach((p) => p.update(camera, delta, elapsed));
    },
    dispose() {
      parts.forEach((p) => p.dispose());
    },
  };
}
