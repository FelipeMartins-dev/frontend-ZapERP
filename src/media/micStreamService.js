/**
 * Ciclo de vida do microfone no ZapERP.
 *
 * Abre o MediaStream somente ao iniciar uma gravação e libera as tracks ao
 * terminar (enviar / cancelar / parar / falha / unmount). Não mantém o mic
 * aberto entre gravações — no iPhone/Safari o indicador do sistema permanece
 * no topo enquanto houver track `live`.
 */

const STORAGE_MIC_GRANTED = "zaperp_mic_perm_granted_v1";
const SESSION_MIC_PERSISTENCE_HINT_SHOWN = "zaperp_mic_persistence_hint_shown_v1";

/** @type {MediaStream | null} */
let activeStream = null;
/** @type {Promise<MediaStream> | null} */
let acquirePromise = null;

function stopStreamTracks(stream) {
  if (!stream) return;
  try {
    const tracks = typeof stream.getTracks === "function" ? stream.getTracks() : [];
    for (const track of tracks) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * True quando não há faixas de áudio vivas (ou não há stream).
 * Usado em testes/assert pós-cleanup.
 */
export function areMicAudioTracksEnded(stream) {
  if (!stream) return true;
  try {
    const tracks = stream.getAudioTracks?.() || [];
    if (!tracks.length) return true;
    return tracks.every((t) => t.readyState === "ended");
  } catch {
    return true;
  }
}

/** Libera o MediaStream ativo (idempotente). Não apaga a marca de permissão. */
export function releaseMicStream() {
  const stream = activeStream;
  activeStream = null;
  acquirePromise = null;
  stopStreamTracks(stream);
  return stream;
}

/**
 * Libera o stream e limpa a marca local de permissão (ex.: NotAllowedError).
 * Preferir `releaseMicStream()` no fim normal da gravação.
 */
export function invalidateMicStream() {
  releaseMicStream();
  clearMicPermissionGrant();
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

/**
 * Abre um MediaStream novo para gravação.
 * Sempre finaliza qualquer stream anterior antes de chamar getUserMedia —
 * nunca reutiliza track encerrada nem mantém o mic aberto “por performance”.
 */
export async function acquireMicStream() {
  // Chamadas concorrentes compartilham a mesma abertura em voo.
  if (acquirePromise) {
    return acquirePromise;
  }

  // Finaliza stream anterior vivo antes de pedir outro (nunca reutiliza track encerrada).
  if (activeStream) {
    const prev = activeStream;
    activeStream = null;
    stopStreamTracks(prev);
  }

  acquirePromise = navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      activeStream = stream;
      acquirePromise = null;
      markMicPermissionGranted();
      return stream;
    })
    .catch((err) => {
      acquirePromise = null;
      activeStream = null;
      throw err;
    });

  return acquirePromise;
}

/** Stream atualmente aberto (se houver). */
export function getActiveMicStream() {
  return activeStream;
}

/**
 * Não aquece o microfone em background — isso deixava o indicador do iOS ligado.
 * Mantido como no-op compatível com chamadas antigas.
 */
export async function warmMicStreamSilently() {
  return false;
}

/** Compatibilidade: não abre microfone automaticamente no arranque do app. */
export function initMicStreamLifecycle() {
  return false;
}
