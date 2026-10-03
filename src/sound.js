/**
 * Bande son + bouton "Sound" (en bas à gauche), sur toutes les pages du site.
 * - Démarre au premier clic, toucher ou touche du clavier (les navigateurs
 *   interdisent le son avant une action de l'utilisateur), avec un fondu.
 * - D'une page à l'autre, la musique reprend là où elle en était : la position
 *   est gardée pendant la visite (sessionStorage). Si le navigateur refuse de
 *   relancer le son tout seul, il repart au premier clic.
 * - Le bouton coupe / remet le son (fondu doux). Le choix est mémorisé.
 * - Le son se met en pause quand l'onglet est caché.
 */

const VOLUME = 0.6;
const STORAGE_KEY = "promenade-sound";
const POS_KEY = "promenade-sound-pos"; // position de lecture, pour enchaîner d'une page à l'autre
export const SOUND_SRC = "/audio/pale-fluorescent-nostalgia.mp3";

export function createSound({ src, button }) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;

  let enabled = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    /* stockage indisponible : son activé par défaut */
  }
  let started = false;
  let fadeId = 0;

  // reprise d'une page à l'autre : position + temps écoulé pendant le changement de page
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(POS_KEY) || "null");
  } catch {
    /* ignore */
  }
  if (saved) {
    audio.addEventListener(
      "loadedmetadata",
      () => {
        const elapsed = saved.playing ? (Date.now() - saved.at) / 1000 : 0;
        const d = audio.duration || 0;
        audio.currentTime = d ? (saved.t + elapsed) % d : saved.t;
      },
      { once: true }
    );
  }
  function savePosition() {
    try {
      sessionStorage.setItem(
        POS_KEY,
        JSON.stringify({ t: audio.currentTime, at: Date.now(), playing: !audio.paused && enabled })
      );
    } catch {
      /* ignore */
    }
  }
  setInterval(savePosition, 1000);
  window.addEventListener("pagehide", savePosition);

  function fadeTo(target, ms, done) {
    const id = ++fadeId;
    const from = audio.volume;
    const t0 = performance.now();
    const step = (now) => {
      if (id !== fadeId) return;
      const k = Math.min(1, (now - t0) / ms);
      audio.volume = from + (target - from) * k;
      if (k < 1) requestAnimationFrame(step);
      else done?.();
    };
    requestAnimationFrame(step);
  }

  async function play(fadeMs = 1800) {
    try {
      await audio.play();
      fadeTo(VOLUME, fadeMs);
    } catch {
      /* lecture refusée (pas encore d'interaction) : on réessaiera au prochain clic */
      started = false;
    }
  }

  function render() {
    button.classList.toggle("is-muted", !enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", enabled ? "Couper le son" : "Activer le son");
  }

  function setEnabled(on) {
    enabled = on;
    render();
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (on) {
      started = true;
      play();
    } else {
      fadeTo(0, 600, () => audio.pause());
    }
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    // Premier clic sur "Sound" alors que la musique n'a pas encore démarré :
    // on la lance (au lieu de la couper).
    if (!started || audio.paused && enabled) {
      setEnabled(true);
      return;
    }
    setEnabled(!enabled);
  });
  // le clic sur le bouton ne doit pas déclencher le démarrage automatique en même temps
  button.addEventListener("pointerdown", (e) => e.stopPropagation());

  document.addEventListener("visibilitychange", () => {
    if (!enabled || !started) return;
    if (document.hidden) audio.pause();
    else play();
  });

  render();

  // la musique jouait sur la page précédente : on essaie de la relancer tout de suite
  if (saved?.playing && enabled) {
    started = true;
    play(500);
  }

  return {
    // à appeler lors d'une action de l'utilisateur (clic sur Entrer, premier clic, touche)
    start() {
      if (started || !enabled) return;
      started = true;
      play();
    },
  };
}

/**
 * Raccourci pour les pages Fragments et About : bouton #sound-toggle +
 * démarrage au premier geste du visiteur.
 */
export function initSiteSound() {
  const button = document.getElementById("sound-toggle");
  if (!button) return null;
  const sound = createSound({ src: SOUND_SRC, button });
  const start = () => sound.start();
  for (const ev of ["pointerdown", "touchend", "keydown"]) window.addEventListener(ev, start);
  return sound;
}
