import * as THREE from "three";

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

function createWater({ terrainSize, level, color, skyColor, lake = null }) {
  // lac : un disque (ovale) posé dans la cuvette ; sinon : une grande nappe (mer)
  const geometry = lake
    ? new THREE.CircleGeometry(lake.radius, 96)
    : new THREE.PlaneGeometry(terrainSize * 1.6, terrainSize * 1.6, 1, 1);
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
      },
    ]),
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
        // scintillements
        float glint = smoothstep(0.86, 1.0, wNoise(vWorld.xz * 0.55 + vec2(uTime * 0.35, -uTime * 0.2)));
        col += glint * 0.35 * (0.4 + fresnel);
        gl_FragColor = vec4(col, 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
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
    },
    dispose() {
      geometry.dispose();
      material.dispose();
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

export function createLivingElements({ living = {}, terrainSize, maxHeight, skyColor, fragments = [], getHeightAt, lake = null }) {
  const cfg = { ...DEFAULTS, ...living, water: { ...DEFAULTS.water, ...(living.water || {}) } };
  const group = new THREE.Group();
  const parts = [];

  // avec un lac : l'eau n'existe que dans la cuvette ; sinon nappe globale (level)
  const waterLevel = lake ? lake.level : cfg.water.level > 0 ? cfg.water.level * maxHeight : -Infinity;
  if (lake || cfg.water.level > 0) {
    parts.push(createWater({ terrainSize, level: waterLevel, color: cfg.water.color, skyColor, lake }));
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
