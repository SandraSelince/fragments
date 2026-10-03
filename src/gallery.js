import * as THREE from "three";
import { collages } from "./collages-data.js";
import { initSiteSound } from "./sound.js";

initSiteSound(); // la musique continue sur cette page (bouton Sound en bas à gauche)
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/**
 * Galerie des collages : des morceaux de papier suspendus dans l'espace,
 * chacun tourné dans une direction différente.
 *
 * - Glisser (souris / trackpad) ou faire défiler : parcourir la bande de collages.
 * - Survol : le papier se redresse légèrement.
 * - Clic sur un collage : il vient se placer droit, face à nous, avec ses
 *   informations dessous (titre, technique, dimensions — voir collages-data.js).
 * - Clic ailleurs : retour à la bande.
 */

const SPACING = 1.55; // écart horizontal moyen entre deux collages
const PAPER_HEIGHT = 3.0; // hauteur d'un collage dans la bande (unités 3D)
const CURL = 0.08; // courbure du papier (0 = parfaitement plat)
const PAPER_OPACITY = 0.86; // légère transparence des collages dans la bande (1 = opaque)
// Mode de fusion des collages quand ils se superposent :
//  "difference" = comme le mode Différence de Photoshop (couleurs inversées dans les zones communes)
//  "normal"     = superposition classique (avec la légère transparence PAPER_OPACITY)
const BLEND_MODE = "difference";
const SATURATION = 1.2; // saturation des collages (1 = couleurs d'origine)
const BACKGROUND = "#f4f2ee"; // couleur du fond (doit correspondre à --papier dans gallery.css)
const CAMERA_Z = 5.2; // distance de la caméra : plus petit = collages plus proches (était 9)

const canvas = document.getElementById("gallery");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0, CAMERA_Z);

// --- génère une disposition "désordonnée mais équilibrée"
const rand = (a, b) => a + Math.random() * (b - a);
const total = collages.length;
const stripWidth = (total - 1) * SPACING;

const loader = new THREE.TextureLoader();
const papers = collages.map((c, i) => {
  const aspect = c.width / c.height;
  const h = PAPER_HEIGHT * rand(0.85, 1.2);
  const w = h * aspect;
  const geo = new THREE.PlaneGeometry(w, h, 16, 16);
  // légère courbure de papier
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) / w;
    pos.setZ(k, -CURL * w * x * x * 2 + rand(-0.004, 0.004));
  }
  geo.computeVertexNormals();

  const tex = loader.load(c.image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.02,
    opacity: PAPER_OPACITY,
    depthWrite: false, // les papiers se voient à travers les uns les autres
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSaturation = { value: SATURATION };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSaturation;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float grey = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = max(mix(vec3(grey), diffuseColor.rgb, uSaturation), 0.0);`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);

  const home = {
    pos: new THREE.Vector3(
      i * SPACING - stripWidth / 2 + rand(-0.5, 0.5),
      rand(-0.7, 0.7) + (i % 2 ? 0.45 : -0.45),
      rand(-2.5, 0.8)
    ),
    rot: new THREE.Euler(rand(-0.45, 0.45), rand(-0.9, 0.9), rand(-0.35, 0.35)),
  };
  mesh.position.copy(home.pos);
  mesh.rotation.copy(home.rot);
  mesh.userData = { index: i, home, phase: Math.random() * 10, hover: 0, size: { w, h } };
  scene.add(mesh);
  return mesh;
});

// --- état
let scrollX = 0; // position de la caméra dans la bande
let scrollTarget = 0;
let focused = null; // collage affiché de face
const mouse = new THREE.Vector2(0, 0);
const mouseSmooth = new THREE.Vector2(0, 0);
const raycaster = new THREE.Raycaster();
let hovered = null;

const captionTitle = document.getElementById("caption-title");
const captionTech = document.getElementById("caption-technique");
const captionSize = document.getElementById("caption-size");

const clampScroll = (x) => Math.max(-stripWidth / 2, Math.min(stripWidth / 2, x));

function focus(mesh) {
  focused = mesh;
  const c = collages[mesh.userData.index];
  captionTitle.textContent = c.title;
  captionTech.textContent = c.technique;
  captionSize.textContent = c.size;
  document.body.classList.add("is-focused");
}
function unfocus() {
  focused = null;
  document.body.classList.remove("is-focused");
}

// --- interactions : glisser / défiler / cliquer
let dragging = false;
let dragMoved = 0;
let lastX = 0;

// tactile : appui long à droite = les fragments défilent vers la droite, à gauche = vers la gauche
const HOLD_DELAY = 250; // ms
const HOLD_SPEED = 3.2; // vitesse de défilement pendant l'appui (unités par seconde)
let holdDir = 0; // -1 gauche, 0 rien, 1 droite
let holdTimer = 0;
let wasHold = false;

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  dragMoved = 0;
  lastX = e.clientX;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* noop */
  }
  wasHold = false;
  clearTimeout(holdTimer);
  if (e.pointerType === "touch" && !focused) {
    const x = e.clientX;
    holdTimer = setTimeout(() => {
      if (dragMoved < 10) {
        holdDir = x > innerWidth / 2 ? 1 : -1;
        wasHold = true;
      }
    }, HOLD_DELAY);
  }
});
canvas.addEventListener("pointermove", (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  dragMoved += Math.abs(dx);
  if (!focused && dragMoved > 4) {
    canvas.classList.add("is-dragging");
    scrollTarget = clampScroll(scrollTarget - dx * 0.012);
  }
});
function endHold() {
  clearTimeout(holdTimer);
  holdDir = 0;
}
canvas.addEventListener("pointercancel", () => {
  dragging = false;
  endHold();
});
canvas.addEventListener("pointerup", (e) => {
  dragging = false;
  endHold();
  canvas.classList.remove("is-dragging");
  if (wasHold) return; // c'était un appui long, pas un clic
  if (dragMoved > 6) return; // c'était un glissement, pas un clic

  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(papers, false)[0];
  if (focused) {
    // clic sur le collage affiché : on le laisse ; clic ailleurs : retour
    if (!hit || hit.object !== focused) unfocus();
  } else if (hit) {
    focus(hit.object);
  }
});
window.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (focused) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    scrollTarget = clampScroll(scrollTarget + d * 0.006);
  },
  { passive: false }
);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") unfocus();
  if (focused) return;
  if (e.key === "ArrowRight") scrollTarget = clampScroll(scrollTarget + SPACING);
  if (e.key === "ArrowLeft") scrollTarget = clampScroll(scrollTarget - SPACING);
});

// --- taille
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();


// ---------------------------------------------------------------- mode "différence"
// WebGL n'a pas de mode Différence natif : on dessine chaque collage seul dans une
// image intermédiaire, puis on le combine avec l'accumulation des précédents,
// du plus lointain au plus proche : |dessous - dessus| là où ils se superposent.
// Le collage affiché de face (après un clic) est posé normalement, par-dessus.
const rtOpts = { type: THREE.HalfFloatType };
const rtPaper = new THREE.WebGLRenderTarget(1, 1, rtOpts);
let accA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
let accB = new THREE.WebGLRenderTarget(1, 1, rtOpts);

const toSRGB = /* glsl */ `
  vec3 toSRGB(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }`;
const compQuad = new FullScreenQuad(
  new THREE.ShaderMaterial({
    uniforms: { tAcc: { value: null }, tPaper: { value: null }, uNormal: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform sampler2D tAcc, tPaper;
      uniform float uNormal;
      varying vec2 vUv;
      ${toSRGB}
      void main() {
        vec4 acc = texture2D(tAcc, vUv);             // accumulation (sRGB, non prémultiplié)
        vec4 pap = texture2D(tPaper, vUv);           // collage seul (linéaire, prémultiplié)
        float a1 = pap.a;
        vec3 c1 = toSRGB(pap.rgb / max(a1, 1e-4));
        vec3 over = mix(c1, abs(acc.rgb - c1), acc.a * (1.0 - uNormal)); // différence là où il y a déjà un collage
        vec3 col = mix(acc.rgb, over, a1);
        gl_FragColor = vec4(col, max(acc.a, a1));
      }`,
  })
);
const finalQuad = new FullScreenQuad(
  new THREE.ShaderMaterial({
    uniforms: { tAcc: { value: null }, uBg: { value: new THREE.Color(BACKGROUND) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform sampler2D tAcc;
      uniform vec3 uBg;
      varying vec2 vUv;
      void main() {
        vec4 acc = texture2D(tAcc, vUv);
        gl_FragColor = vec4(mix(uBg, acc.rgb, acc.a), 1.0);
      }`,
  })
);
finalQuad.material.uniforms.uBg.value.convertLinearToSRGB(); // THREE.Color stocke en linéaire

const camPos = new THREE.Vector3();
function renderDifference() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (rtPaper.width !== size.x || rtPaper.height !== size.y) {
    [rtPaper, accA, accB].forEach((rt) => rt.setSize(size.x, size.y));
  }
  camera.getWorldPosition(camPos);
  // du plus lointain au plus proche ; le collage sélectionné en dernier
  const order = [...papers].sort((a, b) => {
    if (a === focused) return 1;
    if (b === focused) return -1;
    return b.position.distanceToSquared(camPos) - a.position.distanceToSquared(camPos);
  });

  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(accA);
  renderer.clear();
  papers.forEach((p) => (p.visible = false));
  for (const p of order) {
    if (p.material.opacity < 0.01) continue;
    p.visible = true;
    renderer.setRenderTarget(rtPaper);
    renderer.clear();
    renderer.render(scene, camera);
    p.visible = false;

    const u = compQuad.material.uniforms;
    u.tAcc.value = accA.texture;
    u.tPaper.value = rtPaper.texture;
    u.uNormal.value = p === focused ? 1 : 0;
    renderer.setRenderTarget(accB);
    compQuad.render(renderer);
    [accA, accB] = [accB, accA];
  }
  papers.forEach((p) => (p.visible = true));

  renderer.setRenderTarget(null);
  finalQuad.material.uniforms.tAcc.value = accA.texture;
  finalQuad.render(renderer);
}

// --- animation
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const focusQ = new THREE.Quaternion();
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const k = 1 - Math.pow(0.0015, dt); // lissage indépendant de la fréquence d'images

  if (holdDir && !focused) scrollTarget = clampScroll(scrollTarget + holdDir * HOLD_SPEED * dt);
  scrollX += (scrollTarget - scrollX) * k * 0.9;
  mouseSmooth.lerp(mouse, k * 0.6);

  // caméra : suit la bande + légère parallaxe à la souris
  const parallax = focused ? 0.15 : 1;
  camera.position.set(scrollX + mouseSmooth.x * 0.45 * parallax, mouseSmooth.y * 0.3 * parallax, CAMERA_Z);
  camera.lookAt(scrollX, 0, 0);

  // survol
  if (!focused && !dragging) {
    raycaster.setFromCamera(mouse, camera);
    hovered = raycaster.intersectObjects(papers, false)[0]?.object ?? null;
  } else hovered = null;
  canvas.classList.toggle("is-hovering", !!hovered);

  // place du collage affiché : face à la caméra, au-dessus de la légende
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const focusDist = 3.4;
  const viewH = 2 * Math.tan(vFov / 2) * focusDist;

  for (const p of papers) {
    const u = p.userData;
    const isFocused = p === focused;
    u.hover += ((p === hovered ? 1 : 0) - u.hover) * k;

    if (isFocused) {
      // taille : ~62 % de la hauteur de l'écran, sans dépasser la largeur
      const s = Math.min((viewH * 0.62) / u.size.h, (viewH * camera.aspect * 0.8) / u.size.w);
      camera.getWorldDirection(tmpV);
      const target = camera.position.clone().addScaledVector(tmpV, focusDist);
      target.y += viewH * 0.06;
      p.position.lerp(target, k);
      focusQ.copy(camera.quaternion);
      p.quaternion.slerp(focusQ, k);
      p.scale.lerp(tmpV.set(s, s, s), k);
      p.material.opacity += (1 - p.material.opacity) * k;
      p.renderOrder = 1000;
    } else {
      // flottement : chaque papier dérive et tourne doucement
      const ph = u.phase;
      tmpV.copy(u.home.pos);
      tmpV.y += Math.sin(t * 0.5 + ph) * 0.08;
      tmpV.z += u.hover * 0.6 + (focused ? -1.5 : 0);
      p.position.lerp(tmpV, k * 0.8);
      const sway = (1 - u.hover * 0.6);
      tmpQ.setFromEuler(
        new THREE.Euler(
          u.home.rot.x * sway + Math.sin(t * 0.35 + ph) * 0.05,
          u.home.rot.y * sway + Math.sin(t * 0.27 + ph * 1.3) * 0.08,
          u.home.rot.z * sway
        )
      );
      p.quaternion.slerp(tmpQ, k * 0.8);
      p.scale.lerp(tmpV.set(1, 1, 1), k);
      const targetOpacity = focused ? 0.12 : PAPER_OPACITY;
      p.material.opacity += (targetOpacity - p.material.opacity) * k;
      p.renderOrder = 0; // tri automatique du plus lointain au plus proche
    }
  }

  if (BLEND_MODE === "difference") renderDifference();
  else renderer.render(scene, camera);
}
animate();
