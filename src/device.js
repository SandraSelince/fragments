// Qualité adaptée à l'appareil : sur téléphone et tablette, on calcule moins
// de pixels et on met moins d'éléments (fleurs, papiers, poussière), pour rester
// fluide et éviter que le téléphone chauffe. Sur ordinateur, rien ne change.
export const IS_MOBILE =
  window.matchMedia("(pointer: coarse)").matches || Math.min(window.innerWidth, window.innerHeight) < 700;

export const QUALITY = IS_MOBILE
  ? {
      pixelRatio: 1.25, // finesse de l'image 3D (l'écran du téléphone affiche plus, mais l'œil ne voit pas la différence)
      effectsPixelRatio: 1, // finesse des effets (halo, glitchs)
      flora: 0.5, // part des fleurs et rochers gardés
      papers: 0.5, // part des papiers volants
      birds: 0.6, // part des oiseaux
      particles: 0.5, // part de la poussière en suspension
    }
  : {
      pixelRatio: 2,
      effectsPixelRatio: 1.5,
      flora: 1,
      papers: 1,
      birds: 1,
      particles: 1,
    };
