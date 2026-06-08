/** Stream de microfone compartilhado entre telas — evita pedir permissão a cada gravação no mobile. */

/** @type {MediaStream | null} */
let cachedStream = null;
/** @type {Promise<MediaStream> | null} */
let acquirePromise = null;
let pageListenersRegistered = false;

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

function registerPageHideCleanup() {
  if (pageListenersRegistered || typeof window === "undefined") return;
  pageListenersRegistered = true;
  window.addEventListener("pagehide", stopCachedStream);
}

export function isMicSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
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
}

/**
 * Retorna um MediaStream de áudio reutilizável na sessão.
 * Só pede permissão na primeira vez (ou se o track tiver sido encerrado pelo SO).
 */
export async function acquireMicStream() {
  registerPageHideCleanup();

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
      const track = stream.getAudioTracks?.()[0];
      if (track) {
        const onEnded = () => {
          track.removeEventListener("ended", onEnded);
          if (cachedStream === stream) {
            cachedStream = null;
          }
        };
        track.addEventListener("ended", onEnded);
      }
      return stream;
    })
    .catch((err) => {
      acquirePromise = null;
      throw err;
    });

  return acquirePromise;
}
