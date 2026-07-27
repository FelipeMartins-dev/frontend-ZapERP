/** Stream de microfone compartilhado — reutiliza o acesso entre gravações e sessões quando o navegador já concedeu permissão. */

const STORAGE_MIC_GRANTED = "zaperp_mic_perm_granted_v1";
const SESSION_MIC_PERSISTENCE_HINT_SHOWN = "zaperp_mic_persistence_hint_shown_v1";

/** @type {MediaStream | null} */
let cachedStream = null;
/** @type {Promise<MediaStream> | null} */
let acquirePromise = null;

function isLiveStream(stream) {
  if (!stream) return false;
  const tracks = stream.getAudioTracks?.() || [];
  return tracks.some((t) => t.readyState === "live");
}

/**
 * O stream fica em cache entre gravações. Um track pode continuar "live" e ainda
 * assim estar `muted` — o dispositivo foi trocado (fone bluetooth), silenciado pelo
 * sistema ou tomado por outro app. Gravar por cima dele produz um arquivo só com
 * silêncio, então nesse caso vale reabrir o microfone em vez de reaproveitar.
 */
function isUsableStream(stream) {
  if (!stream) return false;
  const tracks = stream.getAudioTracks?.() || [];
  return tracks.some((t) => t.readyState === "live" && t.muted !== true);
}

function stopCachedStream() {
  if (!cachedStream) return;
  try {
    cachedStream.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  cachedStream = null;
  acquirePromise = null;
}

export function isMicSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function hasStoredMicGrant() {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_MIC_GRANTED) === "1";
  } catch {
    return false;
  }
}

export function markMicPermissionGranted() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_MIC_GRANTED, "1");
  } catch {
    /* ignore */
  }
}

export function clearMicPermissionGrant() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_MIC_GRANTED);
  } catch {
    /* ignore */
  }
}

export async function queryMicPermissionState() {
  try {
    const perm = await navigator.permissions?.query?.({ name: "microphone" });
    return perm?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function shouldShowMicPersistenceHint() {
  const perm = await queryMicPermissionState();
  if (perm === "granted") return false;
  try {
    if (sessionStorage.getItem(SESSION_MIC_PERSISTENCE_HINT_SHOWN) === "1") return false;
    sessionStorage.setItem(SESSION_MIC_PERSISTENCE_HINT_SHOWN, "1");
  } catch {
    /* ignore */
  }
  return true;
}

/** Libera o stream (ex.: permissão negada). Não chamar após cada gravação. */
export function invalidateMicStream() {
  stopCachedStream();
  clearMicPermissionGrant();
}

function attachTrackEndedHandler(stream) {
  const track = stream.getAudioTracks?.()[0];
  if (!track) return;
  const onEnded = () => {
    track.removeEventListener("ended", onEnded);
    if (cachedStream === stream) {
      cachedStream = null;
    }
  };
  track.addEventListener("ended", onEnded);
}

/**
 * Retorna um MediaStream de áudio reutilizável.
 * Se o navegador já concedeu permissão permanentemente, não exibe popup.
 */
export async function acquireMicStream() {
  if (isUsableStream(cachedStream)) {
    return cachedStream;
  }

  stopCachedStream();

  if (acquirePromise) {
    return acquirePromise;
  }

  acquirePromise = navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      cachedStream = stream;
      acquirePromise = null;
      markMicPermissionGranted();
      attachTrackEndedHandler(stream);
      return stream;
    })
    .catch((err) => {
      acquirePromise = null;
      throw err;
    });

  return acquirePromise;
}

/**
 * Reabre o microfone somente quando o navegador confirma permissão persistente.
 * Não confia em localStorage para evitar popup repetido após login/logout.
 */
export async function warmMicStreamSilently() {
  if (!isMicSupported()) return false;
  if (isLiveStream(cachedStream)) return true;

  const perm = await queryMicPermissionState();
  if (perm === "denied") {
    clearMicPermissionGrant();
    return false;
  }

  if (perm !== "granted") {
    return false;
  }

  try {
    await acquireMicStream();
    return true;
  } catch {
    return false;
  }
}

/** Compatibilidade: não abre microfone automaticamente no arranque do app. */
export function initMicStreamLifecycle() {
  return false;
}
