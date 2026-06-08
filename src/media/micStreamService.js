/** Stream de microfone compartilhado — reutiliza o acesso entre gravações e sessões quando o navegador já concedeu permissão. */

const STORAGE_MIC_GRANTED = "zaperp_mic_perm_granted_v1";

/** @type {MediaStream | null} */
let cachedStream = null;
/** @type {Promise<MediaStream> | null} */
let acquirePromise = null;
let lifecycleListenersRegistered = false;

function isLiveStream(stream) {
  if (!stream) return false;
  const tracks = stream.getAudioTracks?.() || [];
  return tracks.some((t) => t.readyState === "live");
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
  if (isLiveStream(cachedStream)) {
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
 * Reabre o microfone silenciosamente quando a permissão já foi concedida antes.
 * Evita popup ao voltar ao app após fechar o navegador.
 */
export async function warmMicStreamSilently() {
  if (!isMicSupported()) return false;
  if (isLiveStream(cachedStream)) return true;

  const perm = await queryMicPermissionState();
  if (perm === "denied") {
    clearMicPermissionGrant();
    return false;
  }

  if (perm !== "granted" && !hasStoredMicGrant()) {
    return false;
  }

  try {
    await acquireMicStream();
    return true;
  } catch {
    return false;
  }
}

let warmInFlight = false;

async function runWarm(reason) {
  if (warmInFlight) return;
  warmInFlight = true;
  try {
    await warmMicStreamSilently();
  } catch {
    /* ignore */
  } finally {
    warmInFlight = false;
  }
}

function registerLifecycleListeners() {
  if (lifecycleListenersRegistered || typeof window === "undefined") return;
  lifecycleListenersRegistered = true;

  const onResume = () => {
    if (document.visibilityState && document.visibilityState !== "visible") return;
    void runWarm("resume");
  };

  window.addEventListener("focus", onResume);
  window.addEventListener("pageshow", onResume);
  document.addEventListener("visibilitychange", onResume);

  void navigator.permissions
    ?.query?.({ name: "microphone" })
    ?.then((perm) => {
      perm?.addEventListener?.("change", () => {
        if (perm.state === "granted") {
          markMicPermissionGranted();
          void runWarm("permission_granted");
        } else if (perm.state === "denied") {
          invalidateMicStream();
        }
      });
    })
    .catch(() => {});
}

/** Chamar uma vez no arranque do app (após login). */
export function initMicStreamLifecycle() {
  registerLifecycleListeners();
  void runWarm("init");
}
