import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Mic, Paperclip, SendHorizontal, Square, Trash2, User } from "lucide-react";
import { acquireMicStream, invalidateMicStream, isMicSupported, shouldShowMicPersistenceHint } from "../media/micStreamService";
import { cleanupAudioRecording } from "../media/audioRecordingLifecycle";
import InternalChatContactModal from "./InternalChatContactModal.jsx";

/**
 * @typedef {{ kind: 'text'; content: string }} PayloadText
 * @typedef {{ kind: 'media'; file: File; fieldName?: string; messageType?: string; caption?: string }} PayloadMedia
 * @typedef {{ kind: 'location'; latitude: number; longitude: number; address?: string; caption?: string }} PayloadLoc
 * @typedef {{ kind: 'contact'; name: string; phone?: string; phones?: string[]; organization?: string; caption?: string }} PayloadContact
 * @typedef {PayloadText | PayloadMedia | PayloadLoc | PayloadContact} ComposerPayload
 */

/** Formato tipo WhatsApp: 0:03 ou 1:24 */
function formatRecSeconds(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** @param {{ onSend: (p: ComposerPayload) => Promise<void>; disabled?: boolean; sendError?: string | null; uploadProgress?: number | null }} props */
export default function InternalChatComposer({ onSend, disabled = false, sendError = null, uploadProgress = null }) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const fileAnyRef = useRef(null);

  const [locOpen, setLocOpen] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [addr, setAddr] = useState("");
  const [locCaption, setLocCaption] = useState("");

  const [contactOpen, setContactOpen] = useState(false);

  const [pendingMedia, setPendingMedia] = useState(
    /** @type {{ file: File; messageType?: string; fieldName: string; previewUrl?: string | null } | null} */ (null)
  );
  const [pendingCaption, setPendingCaption] = useState("");

  /** idle | recording | preview */
  const [audioPhase, setAudioPhase] = useState(/** @type {'idle' | 'recording' | 'preview'} */ ("idle"));
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioPreviewFile, setAudioPreviewFile] = useState(/** @type {File | null} */ (null));
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(/** @type {string | null} */ (null));
  const [micPermissionHint, setMicPermissionHint] = useState("");

  const recRef = useRef(/** @type {MediaRecorder | null} */ (null));
  const streamRef = useRef(/** @type {MediaStream | null} */ (null));
  const chunksRef = useRef(/** @type {BlobPart[]} */ ([]));
  const recordStartedAtRef = useRef(0);
  const tickRef = useRef(/** @type {ReturnType<typeof setInterval> | null} */ (null));
  const lastMimeRef = useRef("");

  function clearAudioTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function cleanupRecording({ markCanceled = false, preserveOnStop = false } = {}) {
    return cleanupAudioRecording({
      mediaRecorderRef: recRef,
      streamRef,
      timerRef: tickRef,
      markCanceled,
      requestDataBeforeStop: !markCanceled && preserveOnStop,
      preserveOnStop,
      releaseMic: true,
      setNotRecording: () => {
        setAudioPhase((phase) => (phase === "recording" ? "idle" : phase));
        if (markCanceled) setElapsedSec(0);
      },
      objectUrls: markCanceled && audioPreviewUrl ? [audioPreviewUrl] : null,
    });
  }

  useEffect(() => {
    const url = pendingMedia?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pendingMedia?.previewUrl]);

  useEffect(() => {
    const onPageLeave = () => cleanupRecording({ markCanceled: true });
    window.addEventListener("pagehide", onPageLeave);
    window.addEventListener("beforeunload", onPageLeave);
    return () => {
      window.removeEventListener("pagehide", onPageLeave);
      window.removeEventListener("beforeunload", onPageLeave);
      cleanupRecording({ markCanceled: true });
      if (audioPreviewUrl) {
        try {
          URL.revokeObjectURL(audioPreviewUrl);
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no unmount / pagehide
  }, []);

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    };
  }, [audioPreviewUrl]);

  const openFilePicker = (ref) => {
    ref.current?.click();
  };

  const handleFileChosen = useCallback(
    (e, opts) => {
      const input = e.target;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      const { messageType, fieldName = "file" } = opts;
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      const previewUrl = isImage || isVideo ? URL.createObjectURL(file) : null;
      setPendingCaption("");
      setPendingMedia({ file, messageType, fieldName, previewUrl });
    },
    []
  );

  async function handleSendText() {
    const text = draft.trim();
    if (!text || disabled) return;
    try {
      await onSend({ kind: "text", content: text });
      setDraft("");
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function confirmPendingMedia() {
    if (!pendingMedia || disabled) return;
    const { file, messageType, fieldName } = pendingMedia;
    try {
      await onSend({
        kind: "media",
        file,
        fieldName,
        messageType,
        caption: pendingCaption.trim() || undefined,
      });
      if (pendingMedia.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
      setPendingMedia(null);
      setPendingCaption("");
    } catch {
      /* erro exibido pelo pai */
    }
  }

  function cancelPendingMedia() {
    if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
    setPendingMedia(null);
    setPendingCaption("");
  }

  function resetAudioUi({ invalidateMic = false } = {}) {
    cleanupRecording({ markCanceled: true });
    chunksRef.current = [];
    if (invalidateMic) invalidateMicStream();
    setAudioPhase("idle");
    setElapsedSec(0);
    setAudioPreviewFile(null);
    setAudioPreviewUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          /* ignore */
        }
      }
      return null;
    });
  }

  async function startAudioRecording() {
    if (disabled || audioPhase !== "idle" || !isMicSupported() || typeof MediaRecorder === "undefined") return;
    cleanupRecording({ markCanceled: true });
    try {
      const stream = await acquireMicStream();
      streamRef.current = stream;
      if (await shouldShowMicPersistenceHint()) {
        setMicPermissionHint(
          "O navegador liberou o microfone, mas não confirmou permissão permanente. Para não pedir de novo ao sair e entrar, abra o cadeado/permissões do site e marque Microfone como Permitir."
        );
      }
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.__zapStream = stream;
      recRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      mr.start(200);
      recordStartedAtRef.current = Date.now();
      setElapsedSec(0);
      setAudioPhase("recording");
      clearAudioTick();
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - recordStartedAtRef.current) / 1000));
      }, 250);
    } catch {
      setMicPermissionHint("Não foi possível acessar o microfone. Verifique as permissões do site no navegador.");
      resetAudioUi({ invalidateMic: true });
    }
  }

  async function stopAudioRecording() {
    const mr = recRef.current;
    if (!mr || mr.state === "inactive") {
      cleanupRecording({ markCanceled: true });
      return;
    }
    clearAudioTick();
    await new Promise((resolve) => {
      mr.onstop = resolve;
      try {
        mr.requestData?.();
        mr.stop();
      } catch {
        resolve();
      }
    });
    lastMimeRef.current = mr.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: lastMimeRef.current });
    chunksRef.current = [];
    // Libera mic imediatamente após parar (preview não precisa do stream).
    cleanupAudioRecording({
      mediaRecorder: mr,
      stream: streamRef.current || mr.__zapStream || null,
      streamRef,
      releaseMic: true,
    });
    recRef.current = null;
    const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `audio.${ext}`, { type: blob.type || "audio/webm" });
    const url = URL.createObjectURL(blob);
    setAudioPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setAudioPreviewFile(file);
    setAudioPhase("preview");
  }

  async function sendAudioPreview() {
    if (!audioPreviewFile || disabled) return;
    try {
      await onSend({ kind: "media", file: audioPreviewFile, fieldName: "audio", caption: undefined });
      resetAudioUi();
    } catch {
      /* mantém preview para tentar de novo — mic já estava liberado no stop */
      cleanupRecording({ markCanceled: false });
    }
  }

  function discardAudioPreview() {
    resetAudioUi();
  }

  async function submitLocation() {
    const la = Number(String(lat).replace(",", "."));
    const ln = Number(String(lng).replace(",", "."));
    if (Number.isNaN(la) || Number.isNaN(ln)) return;
    try {
      await onSend({
        kind: "location",
        latitude: la,
        longitude: ln,
        address: addr.trim() || undefined,
        caption: locCaption.trim() || undefined,
      });
      setLocOpen(false);
      setLat("");
      setLng("");
      setAddr("");
      setLocCaption("");
    } catch {
      /* */
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendText();
    }
  }

  const canRecord = typeof MediaRecorder !== "undefined" && isMicSupported();
  const audioBusy = audioPhase === "recording" || audioPhase === "preview";
  const blockOtherActions = disabled || audioBusy;

  return (
    <div className="ic-composer-root">
      {uploadProgress != null && uploadProgress < 1 ? (
        <div className="ic-upload-bar" role="progressbar" aria-valuenow={Math.round(uploadProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="ic-upload-bar-fill" style={{ width: `${Math.min(100, uploadProgress * 100)}%` }} />
        </div>
      ) : null}

      {pendingMedia ? (
        <div className="ic-pending-media">
          {pendingMedia.previewUrl && pendingMedia.file.type.startsWith("image/") ? (
            <img src={pendingMedia.previewUrl} alt="" className="ic-pending-thumb" />
          ) : null}
          {pendingMedia.previewUrl && pendingMedia.file.type.startsWith("video/") ? (
            <video src={pendingMedia.previewUrl} className="ic-pending-thumb" controls muted playsInline />
          ) : null}
          {!pendingMedia.previewUrl ? (
            <div className="ic-pending-file">
              <span className="ic-pending-name">{pendingMedia.file.name}</span>
              <span className="ic-pending-meta">{(pendingMedia.file.size / 1024).toFixed(0)} KB</span>
            </div>
          ) : null}
          <label className="visually-hidden" htmlFor="ic-pending-caption">
            Legenda
          </label>
          <input
            id="ic-pending-caption"
            className="ic-pending-caption"
            placeholder="Legenda opcional…"
            value={pendingCaption}
            onChange={(e) => setPendingCaption(e.target.value)}
          />
          <div className="ic-pending-actions">
            <button type="button" className="ic-pending-btn ic-pending-btn--ghost" onClick={cancelPendingMedia}>
              Cancelar
            </button>
            <button type="button" className="ic-pending-btn ic-pending-btn--primary" disabled={disabled} onClick={() => void confirmPendingMedia()}>
              Enviar
            </button>
          </div>
        </div>
      ) : null}

      {audioPhase === "recording" ? (
        <div className="ic-audio-strip ic-audio-strip--recording" role="status" aria-live="polite">
          <span className="ic-audio-dot" aria-hidden />
          <span className="ic-audio-timer" aria-label={`Gravando ${formatRecSeconds(elapsedSec)}`}>
            {formatRecSeconds(elapsedSec)}
          </span>
          <span className="ic-audio-strip-spacer" />
          <button
            type="button"
            className="ic-audio-stop"
            aria-label="Parar gravação"
            disabled={disabled}
            onClick={() => void stopAudioRecording()}
          >
            <Square size={14} fill="currentColor" strokeWidth={0} aria-hidden />
          </button>
        </div>
      ) : null}

      {audioPhase === "preview" && audioPreviewUrl ? (
        <div className="ic-audio-strip ic-audio-strip--preview">
          <audio className="ic-audio-strip-player" controls src={audioPreviewUrl} preload="metadata">
            Pré-escuta
          </audio>
          <div className="ic-audio-preview-actions">
            <button type="button" className="ic-audio-discard" aria-label="Descartar áudio" disabled={disabled} onClick={discardAudioPreview}>
              <Trash2 size={20} strokeWidth={2} />
            </button>
            <button type="button" className="ic-audio-send-wa" aria-label="Enviar áudio" disabled={disabled} onClick={() => void sendAudioPreview()}>
              <SendHorizontal size={22} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="ic-thread-toolbar" role="toolbar" aria-label="Anexos e ações">
        <button
          type="button"
          className="ic-toolbar-btn"
          aria-label="Anexar arquivo"
          disabled={blockOtherActions}
          onClick={() => openFilePicker(fileAnyRef)}
        >
          <Paperclip size={18} strokeWidth={2} />
        </button>
        <input
          ref={fileAnyRef}
          type="file"
          className="ic-file-input-hidden"
          onChange={(e) => handleFileChosen(e, { fieldName: "attachment" })}
        />

        <button type="button" className="ic-toolbar-btn" aria-label="Localização" disabled={blockOtherActions} onClick={() => setLocOpen(true)}>
          <MapPin size={18} strokeWidth={2} />
        </button>

        <button type="button" className="ic-toolbar-btn" aria-label="Contato" disabled={blockOtherActions} onClick={() => setContactOpen(true)}>
          <User size={18} strokeWidth={2} />
        </button>

        <button
          type="button"
          className={`ic-toolbar-btn${audioPhase === "recording" ? " ic-toolbar-btn--rec" : ""}`}
          aria-label={audioPhase === "idle" ? "Gravar mensagem de voz" : audioPhase === "recording" ? "Gravando" : "Áudio gravado — use enviar ou descartar acima"}
          disabled={disabled || !canRecord || audioPhase === "recording" || audioPhase === "preview"}
          onClick={() => void startAudioRecording()}
        >
          <Mic size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="ic-thread-composer">
        <textarea
          ref={inputRef}
          className="ic-thread-input"
          rows={2}
          placeholder="Mensagem… (emoji e Shift+Enter)"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Mensagem"
        />
        <button
          type="button"
          className="ic-thread-send"
          disabled={disabled || !draft.trim()}
          aria-label="Enviar"
          onClick={() => void handleSendText()}
        >
          <SendHorizontal size={22} strokeWidth={2} />
        </button>
      </div>

      {sendError ? (
        <div className="ic-thread-send-err ic-thread-send-err--below" role="status">
          {sendError}
        </div>
      ) : null}

      {micPermissionHint ? (
        <div className="ic-thread-send-err ic-thread-send-err--below" role="status">
          {micPermissionHint}
        </div>
      ) : null}

      {locOpen ? (
        <dialog
          className="ic-dialog"
          open
          onClick={(e) => {
            if (e.target === e.currentTarget) setLocOpen(false);
          }}
        >
          <div className="ic-dialog-panel" role="document" onClick={(e) => e.stopPropagation()}>
            <h3 className="ic-dialog-title">Enviar localização</h3>
            <div className="ic-dialog-fields">
              <label>
                Latitude
                <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-23.5" />
              </label>
              <label>
                Longitude
                <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-46.6" />
              </label>
              <label>
                Endereço (opcional)
                <input value={addr} onChange={(e) => setAddr(e.target.value)} />
              </label>
              <label>
                Legenda (opcional)
                <input value={locCaption} onChange={(e) => setLocCaption(e.target.value)} />
              </label>
            </div>
            <div className="ic-dialog-actions">
              <button type="button" className="ic-dialog-btn" onClick={() => setLocOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="ic-dialog-btn ic-dialog-btn--primary" disabled={disabled} onClick={() => void submitLocation()}>
                Enviar
              </button>
            </div>
          </div>
        </dialog>
      ) : null}

      <InternalChatContactModal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        disabled={disabled}
        onSendContact={async (payload) => {
          await onSend({ kind: "contact", ...payload });
        }}
      />
    </div>
  );
}
