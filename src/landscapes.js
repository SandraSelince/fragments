// Modèle de contenu : chaque entrée décrit un "paysage" à explorer.
//
// - id, name : identifiants pour la barre de navigation.
// - image    : chemin (dans /public) de l'image utilisée comme texture du
//              terrain, et comme heightmap (relief) SI depthImage n'est pas
//              fourni.
// - depthImage : optionnel, chemin (dans /public) d'une carte de profondeur
//              séparée (ex. générée par un modèle d'IA) utilisée pour le
//              relief à la place de `image`. Doit être cadrée de façon
//              identique à `image` (voir buildTerrainFromImage dans
//              heightmap.js pour le détail).
// - invertHeight : optionnel (bool). `false` par défaut = clair devient
//              haut. Un vrai depth map encode souvent "clair = proche de la
//              caméra" plutôt que "clair = loin" — passer `true` inverse le
//              sens du relief sans toucher au code.
// - fogColor : couleur du brouillard en hexa (ex: 0xd8c9b0), ou `null` pour
//              la calculer automatiquement à partir des pixels du haut de
//              l'image (voir extractSkyColor dans heightmap.js).
// - fogDensity : optionnel, densité du brouillard (voir README pour réglage).
//
// Pour ajouter une vraie toile scannée : déposer l'image dans
// public/paysages/, ajouter une entrée ici. Aucune autre modification de
// code n'est nécessaire.

export const landscapes = [
  {
    id: "collage-pastel",
    name: "Collage pastel",
    // version corrigée (niveaux, balance des blancs, vibrance, agrandie x2) ;
    // l'original est dans collage-pastel-original.jpg
    image: "/paysages/collage-pastel-sol.webp", // sans la bande de ciel du haut (collage-pastel.jpg = image entière corrigée)
    invertHeight: false, // relief tiré de la luminance : ciel clair au fond = montagnes, verts sombres devant = vallée
    fogColor: null,
    fogDensity: 0.22,
    saturation: 1.3,
    relief: { heightScale: 75, curve: 1.7, ridges: 0.3, edgeRise: 0.9, perspective: 0.85, smooth: 2.5 },
    // fragments en touche légère pour laisser voir les couleurs du collage
    fragments: [
      { image: "/paysages/fragments/fragment-dore.webp", zone: "bas", tile: 90, strength: 0.3 },
      { image: "/paysages/fragments/fragment-rose.webp", zone: "pentes", tile: 70, strength: 0.4 },
      { image: "/paysages/fragments/fragment-beige.webp", zone: "sommets", tile: 80, strength: 0.5 },
    ],
    living: {
      water: { level: 0.03, color: 0x2a6f86 }, // juste des mares : les verts et roses du premier plan restent visibles
      birds: 14,
      papers: 30,
      wind: [6, -2],
    },
  },
  {
    id: "fragment-rose",
    name: "Fragment rose",
    image: "/paysages/fragment-rose.webp",
    depthImage: "/paysages/fragment-rose-depth.webp",
    invertHeight: true,
    fogColor: null,
    fogDensity: 0.45, // était 1 : le brouillard blanchissait tout le relief
    glitch: "datamosh", // style des épisodes de glitch : "datamosh" (voir datamosh.js) ou "dream"
    saturation: 1.45, // 1 = couleurs d'origine, 1.5 = plus vives
    // Éléments vivants (voir living.js) : mettre 0 pour en retirer un.
    living: {
      water: { level: 0.12, color: 0x1f6f78 }, // level : hauteur de l'eau (fraction du relief)
      birds: 14,
      papers: 36, // morceaux de tes fragments qui volent dans le vent
      wind: [6, -2],
    },
    // Relief (voir heightmap.js) : augmenter heightScale / edgeRise pour des montagnes plus hautes.
    relief: { heightScale: 80, curve: 1.8, ridges: 0.4, edgeRise: 1.0 },
    // Fleurs 3D (Poly Haven, CC0) : touffes roses de Leipoldtia + marguerites orange d'Ursinia
    flora: [
      {}, // Leipoldtia, réglages par défaut (voir FLORA_DEFAULTS dans flora.js)
      {
        model: "/flore/ursinia.glb",
        textures: {
          color: "/flore/ursinia_diff.webp",
          normal: "/flore/ursinia_nor.webp",
          arm: "/flore/ursinia_arm.webp",
        },
        patches: 35, // massifs de marguerites
        perPatch: 26, // fleurs isolées : plus nombreuses par massif
        patchRadius: 9,
        scale: [20, 34], // le modèle est petit (~16 cm) : on l'agrandit
        maxHeight: 0.42,
        nearStart: 6,
        glow: 0.5,
      },
      {
        // Rochers côtiers (Poly Haven, CC0) : objets pleins, posés aussi sur les rives et les pentes
        model: "/flore/rochers.glb",
        textures: {
          color: "/flore/rochers_diff.webp",
          normal: "/flore/rochers_nor.webp",
          arm: "/flore/rochers_arm.webp",
        },
        alpha: false,
        wind: 0, // les rochers ne bougent pas
        patches: 22, // groupes de rochers
        perPatch: 2,
        patchRadius: 12,
        scale: [1.5, 4], // était [3.5, 8]
        maxSlope: 0.55, // pentes douces (au-delà, ils semblaient flotter)
        maxHeight: 0.6,
        minHeightAboveWater: -1.5, // certains trempent dans l'eau, au bord des rives
        sink: 0.3, // bien ancrés dans le sol
        tilt: 0.25,
        nearStart: 3,
        glow: 0.3, // éclaircit la roche pour l'accorder aux tons pastel
        tint: 0.15,
      },
    ],
    // Fragments de collage plaqués sur le relief (voir terrainMaterial.js).
    fragments: [
      { image: "/paysages/fragments/fragment-dore.webp", zone: "bas", tile: 90, strength: 0.85 },
      { image: "/paysages/fragments/fragment-rose.webp", zone: "pentes", tile: 70, strength: 0.9 },
      { image: "/paysages/fragments/fragment-beige.webp", zone: "sommets", tile: 80, strength: 0.95 },
    ],
  },
  {
    id: "aurore",
    name: "Aurore ocre",
    glitch: "pixelflow", // glitch de transition : lignes de pixels déplacées + courants (voir pixelflow.js)
    // horizon infini : au-delà des bords, la peinture et le relief continuent en miroir jusque dans la brume
    horizon: { extent: 1900, flatten: 0.55, flattenDistance: 500 },
    // aquarelle ocre / bordeaux (ciel blanc et bande de bois retirés) ; ancienne image : aurore.png
    image: "/paysages/aurore-ocre.webp",
    fogColor: 0xe8ddd0, // le blanc crème du papier de l'aquarelle
    fogDensity: 0.3,
    saturation: 1.2,
    unlit: 0.6,
    // relief doux : collines basses plutôt que montagnes
    relief: { heightScale: 30, curve: 1.3, ridges: 0.1, edgeRise: 0.35, perspective: 0.7, smooth: 2.5 },
    // un lac au milieu de la vallée, devant le point de départ (à la place de la mer)
    lake: { x: -10, z: 40, radius: 48, stretch: 0.7, depth: 5 },
    living: {
      water: { level: 0, color: 0x6b4a5a }, // couleur de l'eau profonde (prune), reflets du ciel par-dessus
      birds: 10,
    },
  },
  {
    id: "brume",
    name: "Brume mauve",
    glitch: "shards", // glitch de transition : éclats étirés vers un point de fuite (voir shards.js)
    // aquarelle aux strates bordeaux / émeraude / ocre ; le ciel et les montagnes bleues
    // sont retirés du sol et servent de décor lointain (backdrop). Ancienne image : brume.png
    image: "/paysages/brume-sol.webp",
    fogColor: 0xb8cfdf, // bleu du ciel de l'aquarelle
    fogDensity: 0.35,
    saturation: 1.25,
    unlit: 0.55,
    relief: { heightScale: 32, curve: 1.4, ridges: 0.12, edgeRise: 0.25, perspective: 0.6, smooth: 2.5 },
    // montagnes bleues très lointaines, tout autour de l'horizon
    backdrop: { image: "/paysages/brume-montagnes.webp", height: 240, elevation: 18, repeat: 3, haze: 0.25, baseY: 0 }, // baseY : pied des montagnes posé sur le lac
    // paysage très arboré : bosquets aux couleurs de l'aquarelle, avec des clairières
    // trees: { groves: 45, perGrove: 10, height: [9, 18] }, // arbres retirés
    living: {
      // lac de glace jusqu'aux montagnes (texture « Ice 003 », ambientCG, CC0 : libre, sans crédit)
      water: {
        level: 0.02, // juste au-dessus des creux les plus bas
        texture: "/eau/eau-couleur.webp",
        normalMap: "/eau/eau-normale.webp",
        follow: 880, // disque d'eau qui suit la promenade, jusqu'au pied des montagnes lointaines
        texScale: 0.035, // taille du motif (plus petit = motif plus grand)
        fogScale: 0.25, // brouillard sur l'eau (1 = normal, 0 = aucun) : le lac reste bleu au loin
      },
      birds: 18,
      papers: 20,
    },
    // beaucoup de fleurs : quatre espèces mélangées (Poly Haven, CC0)
    flora: [
      { patches: 50, perPatch: 18 }, // Leipoldtia (rose)
      {
        model: "/flore/ursinia.glb",
        textures: { color: "/flore/ursinia_diff.webp", normal: "/flore/ursinia_nor.webp", arm: "/flore/ursinia_arm.webp" },
        patches: 40, perPatch: 24, patchRadius: 9, scale: [20, 34], maxHeight: 0.6, nearStart: 6, glow: 0.5,
      },
      {
        model: "/flore/pissenlit.glb",
        textures: { color: "/flore/pissenlit_diff.webp", normal: "/flore/pissenlit_nor.webp", arm: "/flore/pissenlit_arm.webp" },
        patches: 40, perPatch: 20, patchRadius: 10, scale: [18, 30], maxHeight: 0.6, nearStart: 5, glow: 0.45,
      },
      {
        model: "/flore/heliophila.glb",
        textures: { color: "/flore/heliophila_diff.webp", normal: "/flore/heliophila_nor.webp", arm: "/flore/heliophila_arm.webp" },
        patches: 25, perPatch: 8, patchRadius: 8, scale: [10, 18], maxHeight: 0.6, nearStart: 4, glow: 0.45,
      },
    ],
  },
];
