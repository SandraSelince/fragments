# Promenade 3D

Une promenade en 3D à l'intérieur d'une peinture de paysage : l'image de la
toile sert à la fois de **heightmap** (le relief du terrain) et de **texture**
(la couleur plaquée dessus), pour donner l'impression d'avoir extrudé la
peinture en 3D. Un brouillard coloré, extrait de l'image, masque l'horizon —
qui se révèle au fur et à mesure qu'on avance.

Vanilla JS + [Three.js](https://threejs.org/), sans framework, mécanisme
repris de l'exemple officiel Three.js *webgl_terrain_fog*.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir l'URL affichée (`http://localhost:5173` en général).

## Navigation

- **Clic gauche maintenu** : avancer.
- **Clic droit maintenu** : reculer.
- **Glisser la souris** (bouton maintenu) : tourner le regard.
- **Barre en bas de l'écran** : changer de paysage.

## Remplacer un placeholder par une vraie toile scannée

1. Déposer l'image (JPEG/PNG) dans `public/paysages/`, par exemple
   `public/paysages/toile-01.jpg`.
2. Ajouter une entrée dans `src/landscapes.js` :

   ```js
   {
     id: "toile-01",
     name: "Toile 01",
     image: "/paysages/toile-01.jpg",
     fogColor: null,       // ou 0xd8c9b0 pour une couleur fixe
     fogDensity: 1,
   }
   ```

3. Recharger la page — la nouvelle entrée apparaît dans la barre de
   navigation, aucune autre modification n'est nécessaire.

**Conseils pour un bon résultat :**
- **Recadrer avant d'importer** : ne garder que la bande peinte elle-même —
  exclure les marges du scan (papier blanc autour, bandeau de matting noir,
  surface de table visible sous le papier déchiré). Toute zone hors peinture
  devient elle aussi du relief et de la texture, ce qui fausse à la fois la
  couleur moyenne extraite (ciel/sol) et la forme du terrain.
- Une image assez contrastée en luminosité donne un relief plus lisible
  (le terrain suit la luminance des pixels — voir ci-dessous).
- Les très hautes résolutions sont automatiquement réduites (max 1536px de
  côté) pour rester fluides ; inutile d'exporter en 4K+.
- Les photos de toile très bruitées (grain de toile, reflets du scan)
  bénéficient d'un lissage plus fort du relief — voir `HEIGHT_BLUR_RADIUS`
  ci-dessous. Sur une vraie toile avec plusieurs bandes de couleur assez
  claires (ex. un ciel pâle ET une vallée claire), un relief à plusieurs
  crêtes est normal : la hauteur suit la luminance, pas la position dans
  l'image, donc deux bandes de luminosité proche peuvent former deux
  reliefs similaires même si elles sont loin l'une de l'autre dans la
  peinture. Un `HEIGHT_BLUR_RADIUS` plus élevé (6-10) adoucit ces reliefs
  sans changer l'algorithme.

### Utiliser une carte de profondeur séparée (depth map)

Un vrai depth map (généré par un modèle d'IA à partir de la toile, par
exemple) donne un relief bien plus cohérent qu'une simple luminance — c'est
ce qui a été fait pour "Fragment rose" (voir `src/landscapes.js`) :

```js
{
  id: "toile-01",
  name: "Toile 01",
  image: "/paysages/toile-01.jpg",
  depthImage: "/paysages/toile-01-depth.png", // relief, séparé de la couleur
  invertHeight: true, // à ajuster : voir ci-dessous
  fogColor: null,
  fogDensity: 1,
}
```

- `depthImage` doit être **cadrée de façon identique** à `image` (même
  recadrage, mêmes proportions) — sinon le relief ne correspond plus à la
  couleur affichée au même endroit.
- Un depth map encode souvent "clair = proche de la caméra", l'inverse de
  la convention par défaut du projet ("clair = haut"). Si le terrain semble
  inversé (les creux de la toile deviennent des sommets, ou l'inverse),
  basculer `invertHeight` entre `true`/`false` et recharger.
- Sans `depthImage`, le comportement est inchangé : `image` sert à la fois
  de relief et de texture, comme avant.

## Comment le relief est calculé (heightmap)

Tout se passe dans `src/heightmap.js`, avec des commentaires détaillés dans
le fichier lui-même. En résumé :

1. L'image est dessinée dans un canvas caché pour lire la couleur de chaque
   pixel.
2. Le terrain est une grille de sommets (`PlaneGeometry`) ; chaque sommet
   correspond à un pixel de l'image (indépendamment de sa résolution réelle).
3. La **luminance** de ce pixel (0 = noir, 1 = blanc) est convertie en
   hauteur : `hauteur = luminance * HEIGHT_SCALE`.
4. La même image est aussi appliquée comme texture sur ce relief.

### Réglages (en haut de `src/heightmap.js`)

| Constante | Effet |
|---|---|
| `HEIGHT_SCALE` | Hauteur maximale du relief. Plus grand = relief plus marqué. `0` = terrain plat. |
| `INVERT_HEIGHT` | `false` (par défaut) : les zones **claires** de la toile deviennent des **collines**. Passer à `true` pour inverser (clair = creux, sombre = colline) — utile si le relief peint d'une toile est plutôt dans les tons sombres. |
| `HEIGHT_BLUR_RADIUS` | Lisse la heightmap en moyennant les pixels voisins avant de calculer la hauteur. `0` = pas de lissage (bien pour les placeholders, déjà lisses). Monter à `2`–`4` sur une vraie photo scannée bruitée, pour éviter un relief "hérissé". |
| `SEGMENTS` | Résolution de la grille du terrain (nombre de sommets). Plus élevé = relief plus détaillé mais plus lourd à calculer/afficher. |
| `TERRAIN_SIZE` | Taille du terrain en unités de scène (largeur = profondeur). |

## Régler la couleur et la densité du brouillard

Deux façons de contrôler le brouillard, dans `src/landscapes.js` :

- `fogColor: null` — la couleur est **calculée automatiquement** en
  moyennant les pixels du haut de l'image (la bande "ciel" d'une peinture de
  paysage par strates horizontales). C'est le réglage recommandé : la brume
  garde toujours la teinte de la toile.
- `fogColor: 0xd8c9b0` — fixe une couleur précise (hexadécimal), qui ignore
  le calcul automatique.

La **densité** se règle avec `fogDensity` (multiplicateur, `1` = valeur de
référence définie par `BASE_FOG_DENSITY` dans `src/main.js`) :
- `fogDensity: 0.5` → brouillard deux fois moins dense, horizon visible plus loin.
- `fogDensity: 2` → brouillard deux fois plus dense, horizon englouti plus vite.

## Particules atmosphériques (poussière en suspension)

Un nuage de particules (`src/particles.js`) vit dans le même décor que le
terrain et le brouillard — pas un effet à part. Il dérive doucement dans
l'air (bruit de Perlin) et s'écarte au passage de la caméra, comme de la
poussière traversée en marchant.

### Réglages (en haut de `src/particles.js`)

| Constante | Effet |
|---|---|
| `PARTICLE_COUNT` | Nombre de particules. Plus élevé = nuage plus dense, mais plus lourd à calculer (voir `STAGGER_GROUPS` ci-dessous pour l'impact perf). |
| `PARTICLE_OPACITY` | Opacité globale. Le blending est additif (les couleurs s'additionnent à ce qu'il y a derrière) : sur un ciel clair ça sature vite vers le blanc, donc mieux vaut garder cette valeur basse (`0.1`–`0.2`) et ajuster la densité via `PARTICLE_COUNT` plutôt que de monter l'opacité. |
| `PARTICLE_SIZE` | Taille des sprites (unités de scène). |
| `DRIFT_AMPLITUDE` | Amplitude de la dérive autour de la position d'origine. |
| `DRIFT_FREQUENCY` | "Zoom" spatial du champ de bruit. Plus petit = mouvement plus ample et plus lent d'une particule à l'autre. |
| `DRIFT_SPEED` | Vitesse à laquelle le champ de bruit évolue dans le temps (à quel point ça a l'air "venteux"). |
| `CAMERA_PUSH_RADIUS` | Distance à partir de laquelle la caméra commence à écarter les particules proches. |
| `CAMERA_PUSH_STRENGTH` | Force maximale de cet écartement, au contact. |
| `SPRING_RATE` | Vitesse de rappel vers la position naturelle (dérive) une fois la caméra éloignée — plus grand = le nuage se "referme" plus vite. |
| `STAGGER_GROUPS` | Répartit le calcul sur plusieurs frames (`2` = la moitié des particules est recalculée à chaque frame, en alternance) pour tenir la performance avec beaucoup de particules. Remonter à `1` si `PARTICLE_COUNT` est baissé et que la marge de performance le permet. |

### Palette des particules

Pour cette V1, chaque particule reçoit une couleur **procédurale** :
interpolation aléatoire entre la couleur du "ciel" et celle du "sol" déjà
extraites de l'image du paysage courant (`skyColor`/`groundColor`, voir
`src/heightmap.js`), plus un léger jitter de teinte/saturation/luminosité
pour casser l'uniformité. Une piste pour une V2 : échantillonner directement
des pixels aléatoires du canvas source de la peinture (déjà utilisé pour la
heightmap/texture) pour donner à chaque particule une vraie couleur exacte
de la toile — la fonction `createParticleField` dans `src/particles.js`
documente où brancher ça.

## Régénérer les images placeholder

Les deux paysages de test (`public/paysages/aurore.png` et `brume.png`) sont
générés par un script, pas dessinés à la main :

```bash
npm run generate:placeholders
```

Modifier les dégradés de couleur dans
`scripts/generate-placeholder-landscapes.mjs` si besoin (uniquement utile
tant que les vraies toiles scannées ne sont pas encore prêtes).

## Build & déploiement

```bash
npm run build
```

Génère un dossier `dist/` entièrement statique, déployable gratuitement sur
[Vercel](https://vercel.com) ou [Netlify](https://netlify.com) :

- **Vercel** : `vercel deploy` (ou glisser-déposer `dist/` sur vercel.com),
  framework preset "Vite".
- **Netlify** : glisser-déposer `dist/` sur app.netlify.com, ou
  `netlify deploy --dir=dist`.

Aucune variable d'environnement, aucune base de données — tout est statique.

## Ce que contient le site aujourd'hui

- **Escape** (`index.html`) : la promenade 3D dans quatre univers (Collage
  pastel, Fragment rose, Aurore ocre, Brume mauve), avec relief, fleurs et
  rochers en 3D, forêt, eau, oiseaux, papiers volants, lumières, et des
  épisodes de glitch qui font passer d'un univers à l'autre.
- **Son** : bande sonore `public/audio/pale-fluorescent-nostalgia.mp3`, gérée
  par `src/sound.js`. Elle démarre au premier clic, toucher ou touche du
  clavier (les navigateurs interdisent le son avant une action du visiteur).
  Le bouton « Sound » en bas à gauche coupe ou remet la musique.
- **Fragments** (`galerie.html`) : les collages suspendus. Légendes dans
  `src/collages-data.js`.
- **About** (`about.html`) : présentation et prochaine exposition.

## Ce qui n'est pas fait

Pas de mode multi-utilisateur, pas de CMS, pas de framework (React/Vue).

## Crédits

- Texture d'eau du lac de Brume mauve (`public/eau/`) : d'après « Plane_Water_low »
  (https://sketchfab.com/3d-models/plane-water-low-041babee8ae24ecd8b11fddeed2f32fc)
  par DonikXD (https://sketchfab.com/DonikXD), licence CC-BY 4.0
  (http://creativecommons.org/licenses/by/4.0/).
- Réalité augmentée (`ar.html`) : MindAR (https://github.com/hiukim/mind-ar-js), licence MIT,
  copie locale dans `src/vendor/mindar/` (adaptée à la version de Three.js du site).
