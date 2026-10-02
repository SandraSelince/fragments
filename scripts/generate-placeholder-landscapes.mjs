// Génère 2 images placeholder "peinture de paysage" : des bandes horizontales
// de couleur (comme les toiles de Sandra) avec une légère variation de
// luminosité en X et Z pour que la heightmap qui en sera extraite produise un
// relief varié (collines/creux), et pas seulement une pente plate.
// À remplacer plus tard par de vrais scans de toiles (voir README.md).

import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "paysages");
mkdirSync(OUT_DIR, { recursive: true });

const WIDTH = 1024;
const HEIGHT = 512;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  return [
    lerp(c1[0], c2[0], t),
    lerp(c1[1], c2[1], t),
    lerp(c1[2], c2[2], t),
  ];
}

// Bandes horizontales : chaque stop est une position verticale (0 = haut du
// ciel, 1 = bas/premier plan) associée à une couleur. Le dégradé entre stops
// imite les glacis superposés de la peinture par strates.
function makeBandedGradient(stops) {
  return (v) => {
    for (let i = 0; i < stops.length - 1; i++) {
      const [posA, colorA] = stops[i];
      const [posB, colorB] = stops[i + 1];
      if (v >= posA && v <= posB) {
        const t = (v - posA) / (posB - posA);
        return lerpColor(colorA, colorB, t);
      }
    }
    return stops[stops.length - 1][1];
  };
}

// Bruit doux multi-fréquences (somme de sinus) : simule les variations de
// pigment/brosse à l'intérieur d'une même bande, en X et en Z, pour que la
// heightmap ait du relief dans toutes les directions plutôt que de simples
// bandes plates.
function softNoise(x, y, seed) {
  const n =
    Math.sin(x * 4.3 + seed) * 0.5 +
    Math.sin(y * 6.1 - seed * 1.7) * 0.35 +
    Math.sin((x + y) * 9.7 + seed * 2.3) * 0.15 +
    Math.sin(x * 17.0 - y * 13.0 + seed) * 0.08;
  return n; // approx range [-1, 1]
}

function generateLandscape(filename, stops, seed) {
  const png = new PNG({ width: WIDTH, height: HEIGHT });

  for (let y = 0; y < HEIGHT; y++) {
    const v = y / (HEIGHT - 1); // 0 haut -> 1 bas
    for (let x = 0; x < WIDTH; x++) {
      const u = x / (WIDTH - 1);

      // Variation douce de la position verticale de lecture du dégradé pour
      // onduler l'horizon des bandes plutôt que des lignes parfaitement droites.
      const wobble = softNoise(u * 2.5, v * 2.5, seed) * 0.035;
      const [r, g, b] = makeBandedGradient(stops)(clamp(v + wobble, 0, 1));

      // Variation de luminosité locale (grain/relief) superposée à la couleur
      // de bande — c'est cette variation qui deviendra le relief (collines).
      const grain = softNoise(u * 8, v * 8, seed * 3.1) * 14;

      const idx = (WIDTH * y + x) << 2;
      png.data[idx] = clamp(Math.round(r + grain), 0, 255);
      png.data[idx + 1] = clamp(Math.round(g + grain), 0, 255);
      png.data[idx + 2] = clamp(Math.round(b + grain), 0, 255);
      png.data[idx + 3] = 255;
    }
  }

  const buffer = PNG.sync.write(png);
  writeFileSync(join(OUT_DIR, filename), buffer);
  console.log(`Écrit : public/paysages/${filename}`);
}

// Palette 1 — "Aurore ocre" : ciel crème, crête terracotta, sol ocre foncé.
generateLandscape(
  "aurore.png",
  [
    [0.0, [235, 220, 198]], // crème (ciel)
    [0.22, [219, 178, 140]], // ocre clair
    [0.42, [193, 104, 63]], // terracotta
    [0.65, [122, 58, 36]], // terracotta foncé
    [0.85, [74, 44, 26]], // ombre profonde
    [1.0, [40, 24, 16]], // premier plan sombre
  ],
  1.0
);

// Palette 2 — "Brume mauve" : ciel gris-mauve, crête sauge, sol noir doux.
generateLandscape(
  "brume.png",
  [
    [0.0, [214, 210, 218]], // gris-mauve pâle (ciel)
    [0.25, [170, 165, 180]], // mauve brumeux
    [0.48, [138, 154, 123]], // vert sauge
    [0.7, [72, 81, 65]], // sauge foncé
    [0.88, [43, 38, 34]], // noir doux
    [1.0, [16, 14, 12]], // premier plan
  ],
  7.0
);
