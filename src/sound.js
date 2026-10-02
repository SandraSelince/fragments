/**
 * Bande son + bouton "Sound" (en bas à gauche).
 * - Démarre au premier clic sur "Entrer" (les navigateurs interdisent le son
 *   avant une action de l'utilisateur), avec un fondu.
 * - Le bouton coupe / remet le son (fondu doux). Le choix est mémorisé.
 * - Le son se met en pause quand l'onglet est caché.
 */

const VOLUME = 0.6;
const STORAGE_KEY = "promenade-sound";

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

  async function play() {
    try {
      await audio.play();
      fadeTo(VOLUME, 1800);
    } catch {
      /* lecture refusée (pas encore d'interaction) : on réessaiera au prochain clic */
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
    setEnabled(!enabled);
  });

  document.addEventListener("visibilitychange", () => {
    if (!enabled || !started) return;
    if (document.hidden) audio.pause();
    else play();
  });

  render();

  return {
    // à appeler lors d'une action de l'utilisateur (clic sur Entrer, premier clic, touche)
    start() {
      if (started || !enabled) return;
      started = true;
      play();
    },
  };
}
