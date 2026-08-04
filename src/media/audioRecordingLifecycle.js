/**
 * Finalização centralizada da gravação de áudio (MediaRecorder + MediaStream).
 * Idempotente: pode ser chamada várias vezes sem erro.
 *
 * Não envia nem converte áudio — só libera recursos do navegador (mic, timers,
 * handlers, AudioContext) para o indicador do sistema sumir no iOS/Safari.
 */

import { releaseMicStream, areMicAudioTracksEnded } from "./micStreamService";

function safeCall(fn) {
  try {
    fn?.();
  } catch {
    /* ignore */
  }
}

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

function clearHandlersNow(recorder) {
  try {
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
  } catch {
    /* ignore */
  }
}

function clearRecorderHandlers(recorder, { preserveOnStop = false } = {}) {
  if (!recorder) return;
  try {
    if (!preserveOnStop) {
      clearHandlersNow(recorder);
      return;
    }
    // Mantém onstop para o envio; limpa o restante agora e o onstop após o handler terminar.
    recorder.ondataavailable = null;
    recorder.onerror = null;
    if (typeof recorder.onstop !== "function") {
      recorder.onstop = null;
      return;
    }
    const prev = recorder.onstop;
    recorder.onstop = (ev) => {
      let result;
      try {
        result = prev.call(recorder, ev);
      } catch (err) {
        clearHandlersNow(recorder);
        throw err;
      }
      if (result != null && typeof result.then === "function") {
        return Promise.resolve(result).finally(() => clearHandlersNow(recorder));
      }
      clearHandlersNow(recorder);
      return result;
    };
  } catch {
    /* ignore */
  }
}

function disconnectAudioGraph({ audioContext, mediaStreamSource, analyser } = {}) {
  safeCall(() => mediaStreamSource?.disconnect?.());
  safeCall(() => analyser?.disconnect?.());
  if (audioContext) {
    try {
      if (typeof audioContext.close === "function" && audioContext.state !== "closed") {
        const p = audioContext.close();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }
}

function revokeObjectUrls(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  for (const url of urls) {
    if (!url) continue;
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {object} [target]
 * @param {import('react').MutableRefObject<MediaRecorder|null>} [target.mediaRecorderRef]
 * @param {MediaRecorder|null} [target.mediaRecorder]
 * @param {import('react').MutableRefObject<MediaStream|null>} [target.streamRef]
 * @param {MediaStream|null} [target.stream]
 * @param {import('react').MutableRefObject<ReturnType<typeof setInterval>|null>} [target.timerRef]
 * @param {() => void} [target.clearTimer]
 * @param {() => void} [target.onDetachMicWatch]
 * @param {boolean} [target.markCanceled]
 * @param {boolean} [target.requestDataBeforeStop] — true no stop/enviar
 * @param {boolean} [target.preserveOnStop] — mantém onstop até o handler de envio terminar
 * @param {boolean} [target.releaseMic=true]
 * @param {() => void} [target.setNotRecording]
 * @param {AudioContext|null} [target.audioContext]
 * @param {MediaStreamAudioSourceNode|null} [target.mediaStreamSource]
 * @param {AnalyserNode|null} [target.analyser]
 * @param {string[]} [target.objectUrls]
 * @param {number|null} [target.rafId]
 * @param {() => void} [target.cancelAnimation]
 * @returns {{ releasedStream: MediaStream|null, tracksEnded: boolean }}
 */
export function cleanupAudioRecording(target = {}) {
  const {
    mediaRecorderRef = null,
    mediaRecorder = null,
    streamRef = null,
    stream = null,
    timerRef = null,
    clearTimer = null,
    onDetachMicWatch = null,
    markCanceled = false,
    requestDataBeforeStop = false,
    preserveOnStop = false,
    releaseMic = true,
    setNotRecording = null,
    audioContext = null,
    mediaStreamSource = null,
    analyser = null,
    objectUrls = null,
    rafId = null,
    cancelAnimation = null,
  } = target;

  const rec = mediaRecorder ?? mediaRecorderRef?.current ?? null;
  const ownedStream =
    stream ?? streamRef?.current ?? rec?.__zapStream ?? null;

  if (rec) {
    safeCall(() => onDetachMicWatch?.());
    safeCall(() => rec.__zapDetachMicWatch?.());

    if (markCanceled) {
      try {
        rec.__zapCanceled = true;
        if (!rec.__zapStopAt) rec.__zapStopAt = Date.now();
      } catch {
        /* ignore */
      }
    } else if (requestDataBeforeStop) {
      try {
        if (!rec.__zapStopAt) rec.__zapStopAt = Date.now();
      } catch {
        /* ignore */
      }
    }

    // Envolve/limpa handlers ANTES do stop — onstop pode disparar de forma síncrona.
    clearRecorderHandlers(rec, { preserveOnStop: Boolean(preserveOnStop) && !markCanceled });

    try {
      if (rec.state && rec.state !== "inactive") {
        if (requestDataBeforeStop) {
          try {
            rec.requestData?.();
          } catch {
            /* ignore */
          }
        }
        rec.stop();
      }
    } catch {
      /* ignore */
    }

    if (mediaRecorderRef) {
      mediaRecorderRef.current = null;
    }
  }

  // Faixas do stream da gravação + cache/ativo do serviço.
  stopStreamTracks(ownedStream);
  if (streamRef) streamRef.current = null;

  let releasedStream = null;
  if (releaseMic) {
    releasedStream = releaseMicStream();
  }

  if (typeof clearTimer === "function") {
    safeCall(clearTimer);
  } else if (timerRef) {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  if (typeof cancelAnimation === "function") {
    safeCall(cancelAnimation);
  } else if (rafId != null) {
    try {
      cancelAnimationFrame(rafId);
    } catch {
      /* ignore */
    }
  }

  disconnectAudioGraph({ audioContext, mediaStreamSource, analyser });
  revokeObjectUrls(objectUrls);
  safeCall(setNotRecording);

  const tracksEnded =
    areMicAudioTracksEnded(ownedStream) && areMicAudioTracksEnded(releasedStream);

  return { releasedStream: releasedStream || ownedStream, tracksEnded };
}

export { areMicAudioTracksEnded };
