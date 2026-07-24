import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { acquireMicStream, invalidateMicStream, isMicSupported, queryMicPermissionState, shouldShowMicPersistenceHint } from "../media/micStreamService";
import { getRespostasSalvas } from "../api/configService";
import { getSocket } from "../socket/socket";
import { capitalizeMessageStart, getAutocorrectEdit } from "../utils/autocorrectText";
import {
  IconCamera,
  IconClose,
  IconDocument,
  IconEmoji,
  IconMic,
  IconPix,
  IconPlus,
  IconSavedReplies,
  IconSend,
  IconSticker,
} from "./conversaComposerIcons";
import {
  IconCamera as TablerCamera,
  IconFileText,
  IconLayoutGrid,
  IconMapPin,
  IconPhoto,
  IconSettings2,
  IconUser,
} from "@tabler/icons-react";

const WA_INPUT_MAX_HEIGHT_PX = 160;
const STICKER_RECENTS_LIMIT = 36;
const AUTO_CORRECT_CONTEXT_WINDOW = 12;
const AUTO_CORRECT_CONTEXT_MATCH = 6;
const RECORDED_AUDIO_MIN_MS = 800;
const RECORDED_AUDIO_MAX_MS = 10 * 60 * 1000;
const RECORDED_AUDIO_MIN_BYTES = 512;
const RECORDED_AUDIO_METADATA_TIMEOUT_MS = 1500;
/** Menu de anexos em portal (bottom-sheet) só no mobile; no desktop fica no wrapper do +. */
const ATTACH_MENU_PORTAL_MQ = "(max-width: 640px)";

const RECORDED_AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
];

const __WA_EMOJIS = [
  "😀","😁","😂","🤣","😊","😍","😘","😅","😎","🙂","🤝","🙏","👏","🔥","✅","❌","⚠️","⭐","🎉","💡","📎","📌","📞","🎧",
  "👍","👎","👌","🤌","✌️","🤞","🫶","💪","🧠","🕒","📍","📅","💬","📷","🎥","🎙️","🎵","🗂️","🧾",
  "❤️","💛","💚","💙","🤍","🖤","💔",
];

function safeString(v) {
  return v == null ? "" : String(v);
}

function pickRecordingMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
  return RECORDED_AUDIO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || null;
}

function audioExtensionFromMime(type) {
  const base = String(type || "").toLowerCase().split(";")[0].trim();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("mp4") || base.includes("aac") || base.includes("m4a")) return "m4a";
  if (base.includes("wav")) return "wav";
  return "webm";
}

function inspectRecordedAudioBlob(blob) {
  if (
    !blob ||
    typeof Audio === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return Promise.resolve({ durationSec: null, error: null, timedOut: false });
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutId);
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timeoutId = setTimeout(() => {
      finish({ durationSec: null, error: null, timedOut: true });
    }, RECORDED_AUDIO_METADATA_TIMEOUT_MS);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const durationSec = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
      finish({ durationSec, error: null, timedOut: false });
    };
    audio.onerror = () => {
      finish({ durationSec: null, error: "decode_error", timedOut: false });
    };
    audio.src = url;
    try {
      audio.load();
    } catch {
      finish({ durationSec: null, error: "decode_error", timedOut: false });
    }
  });
}

function attachRecordedAudioMetadata(file, meta) {
  try {
    Object.defineProperties(file, {
      __zaperpAudioDurationMs: { value: meta.durationMs, enumerable: false },
      __zaperpAudioElapsedMs: { value: meta.elapsedMs, enumerable: false },
      __zaperpAudioMimeType: { value: meta.mimeType, enumerable: false },
      __zaperpAudioBytes: { value: meta.bytes, enumerable: false },
    });
  } catch {
    /* ignore */
  }
  return file;
}

/** Detecta comando "/" no cursor (início da linha ou após espaço). */
function getSlashContext(value, cursor) {
  const s = String(value || "");
  const pos = typeof cursor === "number" ? cursor : s.length;
  let i = pos - 1;
  while (i >= 0 && !/\s/.test(s[i])) {
    if (s[i] === "/") {
      if (i === 0 || /\s/.test(s[i - 1])) {
        return { start: i, end: pos, query: s.slice(i + 1, pos) };
      }
      return null;
    }
    i -= 1;
  }
  return null;
}

function isImageFile(file) {
  if (!file) return false;
  const t = String(file.type || "").toLowerCase();
  return t.startsWith("image/");
}

function buildStickerStorageKey(user) {
  const companyId = user?.company_id ?? user?.empresa_id ?? user?.companyId ?? user?.empresaId ?? "default";
  const userId = user?.id ?? user?.user_id ?? user?.userId ?? "anon";
  return `wa_stickers_recent_${companyId}_${userId}`;
}

function buildAutoCorrectStorageKey(user) {
  const companyId = user?.company_id ?? user?.empresa_id ?? user?.companyId ?? user?.empresaId ?? "default";
  const userId = user?.id ?? user?.user_id ?? user?.userId ?? "anon";
  return `wa_autocorrect_enabled_${companyId}_${userId}`;
}

function readRecentStickers(user) {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(buildStickerStorageKey(user));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function composerPropsAreEqual(prev, next) {
  if (prev.conversaId !== next.conversaId) return false;
  if (prev.departamentoId !== next.departamentoId) return false;
  if (prev.scrollThreadId !== next.scrollThreadId) return false;
  if (prev.loading !== next.loading) return false;
  if (prev.sending !== next.sending) return false;
  if (prev.podeEnviar !== next.podeEnviar) return false;
  if (prev.autoAssumirHint !== next.autoAssumirHint) return false;
  if (prev.headerCompact !== next.headerCompact) return false;
  if (prev.composerEnterInsertsNewline !== next.composerEnterInsertsNewline) return false;
  if (prev.autocorrectToggleInMenu !== next.autocorrectToggleInMenu) return false;
  if (prev.pixActionBusy !== next.pixActionBusy) return false;
  if (prev.pixConfigLoading !== next.pixConfigLoading) return false;
  if (prev.appendTextQueue !== next.appendTextQueue) return false;
  if (prev.mensagensBloqueadasHint !== next.mensagensBloqueadasHint) return false;
  if (prev.atendimentoEncerradoHint !== next.atendimentoEncerradoHint) return false;
  if (prev.atendenteNomeHint !== next.atendenteNomeHint) return false;
  const pr = prev.replyBarPreview;
  const nr = next.replyBarPreview;
  if (pr !== nr) {
    if (!pr || !nr) return false;
    if (pr.thumb !== nr.thumb || pr.title !== nr.title || pr.text !== nr.text) return false;
  }
  return true;
}

/**
 * Área de digitação (composer) — estado de texto isolado para não re-renderizar o thread a cada tecla.
 */
const ConversaComposer = forwardRef(function ConversaComposer(
  {
    conversaId,
    departamentoId,
    scrollThreadId,
    loading,
    sending,
    podeEnviar,
    autoAssumirHint,
    mensagensBloqueadasHint,
    atendimentoEncerradoHint,
    atendenteNomeHint,
    headerCompact,
    composerEnterInsertsNewline,
    autocorrectToggleInMenu,
    user,
    replyBarPreview,
    onCancelReply,
    onSendMessage,
    onSendAudioFile,
    onPasteImageFile,
    onFileInputChange,
    onFototecaInputChange,
    onDocumentInputChange,
    onCameraInputChange,
    onCameraCaptureFile,
    onStickerInputChange,
    onSendStickerFile,
    onPixMenuClick,
    onOpenPixConfig,
    onShareContact,
    onShareLocation,
    onUpdateAutoCorrectPreference,
    pixActionBusy,
    pixConfigLoading,
    appendTextQueue,
    onAppendConsumed,
    onAppendTextApplied,
    onTextMetrics,
    clearTyping,
    showToast,
    showScrollToRecent = false,
    onScrollToRecent,
  },
  ref
) {
  const [texto, setTexto] = useState("");
  const [autoCorrectEnabled, setAutoCorrectEnabled] = useState(true);
  const [autoCorrectFlash, setAutoCorrectFlash] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [stickerOpen, setStickerOpen] = useState(false);
  const [stickerQuery, setStickerQuery] = useState("");
  const [recentStickers, setRecentStickers] = useState([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [savedRepliesOpen, setSavedRepliesOpen] = useState(false);
  const [savedRepliesQuery, setSavedRepliesQuery] = useState("");
  const [savedRepliesList, setSavedRepliesList] = useState([]);
  const [savedRepliesLoading, setSavedRepliesLoading] = useState(false);
  const [savedRepliesError, setSavedRepliesError] = useState(null);
  const [savedRepliesIndex, setSavedRepliesIndex] = useState(0);
  const [savedRepliesViaPicker, setSavedRepliesViaPicker] = useState(false);
  const [attachMenuPortal, setAttachMenuPortal] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(ATTACH_MENU_PORTAL_MQ).matches;
  });
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [cameraCaptureOpen, setCameraCaptureOpen] = useState(false);
  const [cameraCaptureStarting, setCameraCaptureStarting] = useState(false);
  const [cameraCaptureError, setCameraCaptureError] = useState("");

  const savedRepliesPanelRef = useRef(null);
  const savedRepliesCacheRef = useRef({ depKey: null, list: null });
  const slashCtxRef = useRef(null);
  const savedRepliesModeRef = useRef("slash");
  const emojiPanelRef = useRef(null);
  const emojiSearchRef = useRef(null);
  const stickerPanelRef = useRef(null);
  const stickerSearchRef = useRef(null);
  const stickerBtnRef = useRef(null);
  const attachMenuRef = useRef(null);
  const attachMenuPanelRef = useRef(null);
  const fileInputRef = useRef(null);
  const fototecaInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraCanvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const audioInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const stickerInputRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const autoCorrectFlashTimeoutRef = useRef(null);
  const autoCorrectTrackedRef = useRef([]);
  const autoCorrectIgnoredRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  // Buffer/tempo/cancelamento de gravação vivem POR gravação (na instância do MediaRecorder,
  // props __zap*), não em refs compartilhadas — evita que gravações sequenciais se sobreponham.
  const recordingTimerRef = useRef(null);
  const lastConversaIdRef = useRef(conversaId);
  const prevTextLenRef = useRef(0);
  const prevTextConversaRef = useRef(null);
  // Trava síncrona contra double-submit (Enter duplo ou clique duplo antes do re-render do React).
  const sendLockedRef = useRef(false);

  const normalizeAutoWord = useCallback((value) => String(value || "").toLowerCase(), []);

  const getAutoContext = useCallback((text, start, end) => {
    const value = String(text || "");
    const s = Math.max(0, Number(start) || 0);
    const e = Math.max(s, Number(end) || s);
    return {
      before: value.slice(Math.max(0, s - AUTO_CORRECT_CONTEXT_WINDOW), s),
      after: value.slice(e, Math.min(value.length, e + AUTO_CORRECT_CONTEXT_WINDOW)),
    };
  }, []);

  const contextMatches = useCallback((candidate, tracked) => {
    const beforeSize = Math.min(AUTO_CORRECT_CONTEXT_MATCH, candidate.before.length, tracked.before.length);
    const afterSize = Math.min(AUTO_CORRECT_CONTEXT_MATCH, candidate.after.length, tracked.after.length);
    const beforeOk =
      beforeSize === 0 || candidate.before.slice(-beforeSize) === tracked.before.slice(-beforeSize);
    const afterOk = afterSize === 0 || candidate.after.slice(0, afterSize) === tracked.after.slice(0, afterSize);
    return beforeOk && afterOk;
  }, []);

  const resetAutocorrectTracking = useCallback(() => {
    autoCorrectTrackedRef.current = [];
    autoCorrectIgnoredRef.current = [];
  }, []);

  const hasWordWithContext = useCallback(
    (text, wordLower, context) => {
      const value = String(text || "");
      if (!value || !wordLower) return false;
      const re = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
      let m;
      while ((m = re.exec(value)) != null) {
        const found = normalizeAutoWord(m[0]);
        if (found !== wordLower) continue;
        const ctx = getAutoContext(value, m.index, m.index + m[0].length);
        if (contextMatches(ctx, context)) return true;
      }
      return false;
    },
    [contextMatches, getAutoContext, normalizeAutoWord]
  );

  const focusInput = useCallback(({ force = false } = {}) => {
    if (typeof window !== "undefined" && !force) {
      const isCoarse = window.matchMedia?.("(pointer: coarse)")?.matches;
      const el = inputRef.current;
      if (isCoarse && el && document.activeElement !== el) return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        try {
          el.focus({ preventScroll: true });
        } catch {
          el.focus();
        }
      });
    });
  }, []);

  const syncTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el || el.tagName !== "TEXTAREA") return;
    if (!String(el.value || "").trim()) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    const maxPx = parseFloat(getComputedStyle(el).maxHeight);
    const cap =
      Number.isFinite(maxPx) && maxPx > 0 ? Math.min(maxPx, WA_INPUT_MAX_HEIGHT_PX) : WA_INPUT_MAX_HEIGHT_PX;
    const next = Math.min(el.scrollHeight, cap);
    el.style.height = `${next}px`;
  }, []);

  const emitTypingStop = useCallback(() => {
    if (!conversaId) return;
    const socket = getSocket();
    if (socket?.connected) socket.emit("typing_stop", { conversa_id: conversaId });
  }, [conversaId]);

  const emitTypingStart = useCallback(() => {
    if (!conversaId) return;
    const socket = getSocket();
    if (socket?.connected) socket.emit("typing_start", { conversa_id: conversaId });
  }, [conversaId]);

  const closeSavedReplies = useCallback(() => {
    slashCtxRef.current = null;
    savedRepliesModeRef.current = "slash";
    setSavedRepliesViaPicker(false);
    setSavedRepliesOpen(false);
    setSavedRepliesQuery("");
    setSavedRepliesIndex(0);
    setSavedRepliesError(null);
  }, []);

  const openSavedRepliesPicker = useCallback(() => {
    if (!conversaId || !podeEnviar || isRecording) return;
    setEmojiOpen(false);
    setEmojiQuery("");
    setStickerOpen(false);
    setStickerQuery("");
    setAttachMenuOpen(false);
    savedRepliesModeRef.current = "picker";
    slashCtxRef.current = null;
    setSavedRepliesViaPicker(true);
    setSavedRepliesQuery("");
    setSavedRepliesError(null);
    setSavedRepliesOpen(true);
    focusInput();
  }, [conversaId, focusInput, isRecording, podeEnviar]);

  const closePanels = useCallback(() => {
    let closed = false;
    if (savedRepliesOpen) {
      closeSavedReplies();
      closed = true;
    }
    if (emojiOpen) {
      setEmojiOpen(false);
      setEmojiQuery("");
      closed = true;
    }
    if (stickerOpen) {
      setStickerOpen(false);
      setStickerQuery("");
      closed = true;
    }
    if (attachMenuOpen) {
      setAttachMenuOpen(false);
      closed = true;
    }
    return closed;
  }, [attachMenuOpen, closeSavedReplies, emojiOpen, savedRepliesOpen, stickerOpen]);

  const stopCameraStream = useCallback(() => {
    const stream = cameraStreamRef.current;
    cameraStreamRef.current = null;
    if (stream) {
      stream.getTracks?.().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
    }
    if (cameraVideoRef.current) {
      try {
        cameraVideoRef.current.srcObject = null;
      } catch {
        /* ignore */
      }
    }
  }, []);

  const closeCameraCapture = useCallback(() => {
    stopCameraStream();
    setCameraCaptureOpen(false);
    setCameraCaptureStarting(false);
    setCameraCaptureError("");
  }, [stopCameraStream]);

  const handleCancelRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && isRecording) {
      rec.__zapCanceled = true;
      rec.__zapStopAt = Date.now();
      try {
        if (rec.state !== "inactive") {
          rec.stop();
        }
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [isRecording]);

  useEffect(() => {
    if (String(lastConversaIdRef.current ?? "") !== String(conversaId ?? "") && mediaRecorderRef.current) {
      handleCancelRecording();
    }
    if (String(lastConversaIdRef.current ?? "") !== String(conversaId ?? "")) {
      closeSavedReplies();
    }
    lastConversaIdRef.current = conversaId;
  }, [conversaId, closeSavedReplies, handleCancelRecording]);

  // Libera a trava de envio quando o envio em andamento termina (sucesso ou erro).
  useEffect(() => {
    if (!sending) sendLockedRef.current = false;
  }, [sending]);

  useEffect(() => {
    return () => {
      const rec = mediaRecorderRef.current;
      if (!rec) return;
      rec.__zapCanceled = true;
      try {
        if (rec.state !== "inactive") {
          rec.stop();
        }
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null;
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => stopCameraStream();
  }, [stopCameraStream]);

  useImperativeHandle(
    ref,
    () => ({
      focusInput,
      setText: (value) => setTexto(String(value ?? "")),
      appendText: (value) => {
        const v = String(value || "").trim();
        if (!v) return;
        setTexto((prev) => (prev ? `${prev}\n${v}` : v));
        focusInput();
      },
      getInputElement: () => inputRef.current,
      isRecording: () => isRecording,
      cancelRecording: handleCancelRecording,
      closePanels,
      getText: () => texto,
    }),
    [focusInput, handleCancelRecording, closePanels, isRecording, texto]
  );

  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [texto, syncTextareaHeight]);

  useLayoutEffect(() => {
    const len = String(texto ?? "").length;
    const threadKey = scrollThreadId ?? conversaId;
    onTextMetrics?.({ length: len, threadKey, loading });
    if (String(prevTextConversaRef.current) !== String(threadKey ?? "")) {
      prevTextConversaRef.current = threadKey;
      prevTextLenRef.current = len;
      return;
    }
    const prevLen = prevTextLenRef.current;
    prevTextLenRef.current = len;
    if (prevLen <= 0 || len !== 0) return;
    onTextMetrics?.({ length: len, threadKey, loading, cleared: true });
  }, [texto, conversaId, scrollThreadId, loading, onTextMetrics]);

  useEffect(() => {
    resetAutocorrectTracking();
    setTexto("");
    setEmojiOpen(false);
    setEmojiQuery("");
    setStickerOpen(false);
    setStickerQuery("");
    setAttachMenuOpen(false);
  }, [conversaId, resetAutocorrectTracking]);

  useEffect(() => {
    setRecentStickers(readRecentStickers(user));
  }, [user?.id, user?.company_id, user?.empresa_id]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(buildAutoCorrectStorageKey(user));
      setAutoCorrectEnabled(raw == null ? true : raw === "1");
    } catch {
      setAutoCorrectEnabled(true);
    }
  }, [user?.id, user?.company_id, user?.empresa_id]);

  useEffect(() => {
    return () => {
      if (autoCorrectFlashTimeoutRef.current) {
        clearTimeout(autoCorrectFlashTimeoutRef.current);
        autoCorrectFlashTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!appendTextQueue) return;
    const value = appendTextQueue;
    onAppendConsumed?.();
    setTexto((prev) => (prev ? `${prev}\n${value}` : value));
    focusInput();
    onAppendTextApplied?.();
  }, [appendTextQueue, onAppendConsumed, onAppendTextApplied, focusInput]);

  useEffect(() => {
    if (!conversaId) return;
    if (!safeString(texto)) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      emitTypingStop();
      return;
    }
    const t = typingTimeoutRef.current;
    if (t) clearTimeout(t);
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
      emitTypingStart();
    }, 400);
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [conversaId, texto, emitTypingStart, emitTypingStop]);

  useEffect(() => {
    return () => {
      if (conversaId) {
        const socket = getSocket();
        if (socket?.connected) socket.emit("typing_stop", { conversa_id: conversaId });
        clearTyping?.(conversaId);
      }
    };
  }, [conversaId, clearTyping]);

  useEffect(() => {
    if (!savedRepliesOpen || !conversaId) return undefined;
    const depKey = departamentoId != null ? String(departamentoId) : "none";
    const cached = savedRepliesCacheRef.current;
    if (cached.depKey === depKey && Array.isArray(cached.list)) {
      setSavedRepliesList(cached.list);
      return undefined;
    }
    let cancelled = false;
    setSavedRepliesLoading(true);
    setSavedRepliesError(null);
    getRespostasSalvas(departamentoId ?? null, { contexto: 'atendimento' })
      .then((list) => {
        if (cancelled) return;
        const arr = Array.isArray(list) ? list : [];
        savedRepliesCacheRef.current = { depKey, list: arr };
        setSavedRepliesList(arr);
      })
      .catch(() => {
        if (cancelled) return;
        setSavedRepliesList([]);
        setSavedRepliesError("Não foi possível carregar respostas salvas.");
      })
      .finally(() => {
        if (!cancelled) setSavedRepliesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [savedRepliesOpen, conversaId, departamentoId]);

  useEffect(() => {
    savedRepliesCacheRef.current = { depKey: null, list: null };
  }, [conversaId, departamentoId]);

  useEffect(() => {
    setSavedRepliesIndex(0);
  }, [savedRepliesQuery, savedRepliesList]);

  useEffect(() => {
    if (!savedRepliesOpen) return;
    const panel = savedRepliesPanelRef.current;
    const active = panel?.querySelector?.(".wa-savedReplyItem.isActive");
    active?.scrollIntoView?.({ block: "nearest" });
  }, [savedRepliesIndex, savedRepliesOpen]);

  const filteredSavedReplies = useMemo(() => {
    const q = String(savedRepliesQuery || "").trim().toLowerCase();
    const list = Array.isArray(savedRepliesList) ? savedRepliesList : [];
    if (!q) return list;
    return list.filter((r) => {
      const t = `${r?.titulo || ""} ${r?.texto || ""}`.toLowerCase();
      return t.includes(q);
    });
  }, [savedRepliesList, savedRepliesQuery]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDoc = (e) => {
      const panel = emojiPanelRef.current;
      if (panel && panel.contains(e.target)) return;
      setEmojiOpen(false);
      setEmojiQuery("");
    };
    document.addEventListener("mousedown", onDoc);
    requestAnimationFrame(() => emojiSearchRef.current?.focus?.());
    return () => document.removeEventListener("mousedown", onDoc);
  }, [emojiOpen]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(ATTACH_MENU_PORTAL_MQ);
    const sync = () => setAttachMenuPortal(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDoc = (e) => {
      const wrap = attachMenuRef.current;
      const panel = attachMenuPanelRef.current;
      if ((wrap && wrap.contains(e.target)) || (panel && panel.contains(e.target))) return;
      setAttachMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [attachMenuOpen]);

  useEffect(() => {
    if (stickerOpen) setRecentStickers(readRecentStickers(user));
  }, [stickerOpen, user?.id, user?.company_id, user?.empresa_id]);

  useEffect(() => {
    if (!stickerOpen) return;
    const onDoc = (e) => {
      const panel = stickerPanelRef.current;
      const btn = stickerBtnRef.current;
      if ((panel && panel.contains(e.target)) || (btn && btn.contains(e.target))) return;
      setStickerOpen(false);
      setStickerQuery("");
    };
    document.addEventListener("mousedown", onDoc);
    requestAnimationFrame(() => stickerSearchRef.current?.focus?.());
    return () => document.removeEventListener("mousedown", onDoc);
  }, [stickerOpen]);

  useEffect(() => {
    if (!isRecording) return;
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, [isRecording]);

  const runInputFlash = useCallback(() => {
    setAutoCorrectFlash(true);
    if (autoCorrectFlashTimeoutRef.current) {
      clearTimeout(autoCorrectFlashTimeoutRef.current);
    }
    autoCorrectFlashTimeoutRef.current = setTimeout(() => {
      setAutoCorrectFlash(false);
      autoCorrectFlashTimeoutRef.current = null;
    }, 220);
  }, []);

  const updateAutoCorrectPreference = useCallback(
    (next) => {
      setAutoCorrectEnabled(next);
      onUpdateAutoCorrectPreference?.(next);
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(buildAutoCorrectStorageKey(user), next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [onUpdateAutoCorrectPreference, user]
  );

  const applyAutocorrectFromEvent = useCallback(
    (e, triggerChar) => {
      if (!autoCorrectEnabled) return null;
      if (e.nativeEvent?.isComposing || e.isComposing) return null;
      const el = e.currentTarget;
      if (!el || typeof el.selectionStart !== "number" || typeof el.selectionEnd !== "number") return null;

      const edit = getAutocorrectEdit({
        text: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
        triggerChar,
      });
      if (!edit) return null;

      const originalWord = String(el.value || "").slice(edit.replaceStart, edit.replaceEnd);
      const originalLower = normalizeAutoWord(originalWord);
      const candidateContext = getAutoContext(el.value, edit.replaceStart, edit.replaceEnd);
      const shouldIgnore = autoCorrectIgnoredRef.current.some(
        (item) => item?.originalLower === originalLower && contextMatches(candidateContext, item.context)
      );
      if (shouldIgnore) return null;

      e.preventDefault();
      let nextValue = "";
      if (typeof el.setRangeText === "function") {
        el.setRangeText(edit.replacement, edit.replaceStart, edit.replaceEnd, "end");
        nextValue = String(el.value || "");
        setTexto(nextValue);
        syncTextareaHeight();
      } else {
        const cur = String(el.value || "");
        nextValue = `${cur.slice(0, edit.replaceStart)}${edit.replacement}${cur.slice(edit.replaceEnd)}`;
        const nextPos = edit.replaceStart + edit.replacement.length;
        setTexto(nextValue);
        requestAnimationFrame(() => {
          try {
            el.setSelectionRange?.(nextPos, nextPos);
          } catch {
            /* ignore */
          }
        });
      }

      const correctedLower = normalizeAutoWord(edit.correctedWord);
      const correctionContext = getAutoContext(
        nextValue,
        edit.replaceStart,
        edit.replaceStart + String(edit.correctedWord || "").length
      );
      autoCorrectTrackedRef.current.push({
        originalLower,
        correctedLower,
        context: correctionContext,
      });

      runInputFlash();
      return edit;
    },
    [autoCorrectEnabled, contextMatches, getAutoContext, normalizeAutoWord, runInputFlash, syncTextareaHeight]
  );

  const handleInputChange = useCallback(
    (e) => {
      const nextValue = capitalizeMessageStart(texto, e.target.value);
      const tracked = autoCorrectTrackedRef.current;

      if (tracked.length > 0) {
        const remaining = [];
        for (const item of tracked) {
          const stillCorrected = hasWordWithContext(nextValue, item.correctedLower, item.context);
          if (stillCorrected) {
            remaining.push(item);
            continue;
          }
          const revertedToOriginal = hasWordWithContext(nextValue, item.originalLower, item.context);
          if (revertedToOriginal) {
            autoCorrectIgnoredRef.current.push({
              originalLower: item.originalLower,
              context: item.context,
            });
          }
        }
        autoCorrectTrackedRef.current = remaining;
      }

      if (!nextValue) {
        resetAutocorrectTracking();
      }

      setTexto(nextValue);

      const cursor =
        typeof e.target.selectionStart === "number" ? e.target.selectionStart : nextValue.length;
      const slashCtx = getSlashContext(nextValue, cursor);
      if (slashCtx) {
        slashCtxRef.current = slashCtx;
        savedRepliesModeRef.current = "slash";
        setSavedRepliesViaPicker(false);
        setSavedRepliesOpen(true);
        setSavedRepliesQuery(slashCtx.query);
        setSavedRepliesError(null);
      } else if (savedRepliesOpen) {
        closeSavedReplies();
      }
    },
    [closeSavedReplies, hasWordWithContext, resetAutocorrectTracking, savedRepliesOpen, texto]
  );

  const handleSendFromComposer = useCallback(
    (textToSend) => {
      if (!conversaId || !podeEnviar) return;
      // Trava síncrona: impede duplo envio se o React ainda não re-renderizou com sending=true.
      if (sendLockedRef.current || sending) return;
      const t = safeString(textToSend).trim();
      if (!t) return;
      sendLockedRef.current = true;
      resetAutocorrectTracking();
      setTexto("");
      onSendMessage?.(t);
    },
    [conversaId, onSendMessage, podeEnviar, resetAutocorrectTracking, sending]
  );

  const insertSavedReply = useCallback(
    (replyText) => {
      const text = String(replyText || "");
      if (!text) return;
      const el = inputRef.current;
      const mode = savedRepliesModeRef.current;

      if (mode === "slash") {
        const ctx = slashCtxRef.current;
        if (!ctx) return;
        const cur = String(texto || "");
        const next = cur.slice(0, ctx.start) + text + cur.slice(ctx.end);
        closeSavedReplies();
        setTexto(next);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              el?.focus({ preventScroll: true });
              const pos = ctx.start + text.length;
              el?.setSelectionRange?.(pos, pos);
            } catch {
              /* ignore */
            }
          });
        });
        return;
      }

      const cur = String(texto || "");
      const start = typeof el?.selectionStart === "number" ? el.selectionStart : cur.length;
      const end = typeof el?.selectionEnd === "number" ? el.selectionEnd : cur.length;
      const next = cur.slice(0, start) + text + cur.slice(end);
      closeSavedReplies();
      setTexto(next);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            el?.focus({ preventScroll: true });
            const pos = start + text.length;
            el?.setSelectionRange?.(pos, pos);
          } catch {
            /* ignore */
          }
        });
      });
    },
    [closeSavedReplies, texto]
  );

  const handleKeyDownInput = useCallback(
    (e) => {
      if (e.nativeEvent?.isComposing || e.isComposing) return;

      const key = String(e.key || "");

      if (savedRepliesOpen) {
        const list = filteredSavedReplies;
        if (key === "Escape") {
          e.preventDefault();
          closeSavedReplies();
          return;
        }
        if (key === "ArrowDown" && list.length > 0) {
          e.preventDefault();
          setSavedRepliesIndex((i) => Math.min(i + 1, list.length - 1));
          return;
        }
        if (key === "ArrowUp" && list.length > 0) {
          e.preventDefault();
          setSavedRepliesIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (key === "Enter" || key === "Tab") {
          if (list.length > 0) {
            const item = list[savedRepliesIndex] || list[0];
            if (item?.texto) {
              e.preventDefault();
              insertSavedReply(item.texto);
            }
          } else if (key === "Enter" && !composerEnterInsertsNewline && !e.shiftKey) {
            e.preventDefault();
          }
          return;
        }
      }

      const punctuationTrigger = key.length === 1 && [".", ",", "!", "?", ";", ":"].includes(key);
      if (key === " " || punctuationTrigger) {
        applyAutocorrectFromEvent(e, key);
        return;
      }

      if (key !== "Enter") return;

      if (composerEnterInsertsNewline) {
        applyAutocorrectFromEvent(e, "\n");
        return;
      }

      if (e.shiftKey) {
        applyAutocorrectFromEvent(e, "\n");
        return;
      }

      const edit = applyAutocorrectFromEvent(e, "\n");
      e.preventDefault();
      const textToSend = edit
        ? `${String(e.currentTarget?.value || "")}`.replace(/\n$/, "")
        : texto;
      handleSendFromComposer(textToSend);
    },
    [applyAutocorrectFromEvent, closeSavedReplies, composerEnterInsertsNewline, filteredSavedReplies, handleSendFromComposer, insertSavedReply, savedRepliesIndex, savedRepliesOpen, texto]
  );

  const insertEmoji = useCallback(
    (emoji) => {
      const em = String(emoji || "");
      if (!em) return;
      const el = inputRef.current;
      if (!el) {
        setTexto((prev) => (prev ? `${prev}${em}` : em));
        return;
      }

      const cur = String(texto || "");
      const start = typeof el.selectionStart === "number" ? el.selectionStart : cur.length;
      const end = typeof el.selectionEnd === "number" ? el.selectionEnd : cur.length;
      const next = cur.slice(0, start) + em + cur.slice(end);
      setTexto(next);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            el.focus({ preventScroll: true });
            const pos = start + em.length;
            el.setSelectionRange?.(pos, pos);
          } catch {
            /* ignore */
          }
        });
      });
    },
    [texto]
  );

  const handlePaste = useCallback(
    (e) => {
      if (!conversaId) return;
      const dt = e.clipboardData;
      if (!dt) return;

      const files = dt.files && dt.files.length > 0 ? Array.from(dt.files) : [];
      const items = dt.items && dt.items.length > 0 ? Array.from(dt.items) : [];

      let pickedFile = null;

      if (files.length > 0) {
        pickedFile = files.find((f) => f && isImageFile(f)) || files[0];
      } else if (items.length > 0) {
        const fileItem = items.find((it) => it.kind === "file" && it.type && it.type.startsWith("image/"));
        if (fileItem) pickedFile = fileItem.getAsFile();
      }

      if (pickedFile && isImageFile(pickedFile)) {
        e.preventDefault();
        onPasteImageFile?.(pickedFile);
      }
    },
    [conversaId, onPasteImageFile]
  );

  const openNativeCameraFallback = useCallback(() => {
    cameraInputRef.current?.click();
  }, []);

  const openFototecaPicker = useCallback(() => {
    const input = fototecaInputRef.current;
    if (!input) return;
    input.removeAttribute("capture");
    input.value = "";
    input.click();
  }, []);

  const handleOpenCameraCapture = useCallback(async () => {
    if (!conversaId || sending || !podeEnviar || isRecording) return;
    closeSavedReplies();
    setAttachMenuOpen(false);
    setEmojiOpen(false);
    setStickerOpen(false);

    const mediaDevices =
      typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices
        : null;

    if (!mediaDevices || (typeof window !== "undefined" && !window.isSecureContext)) {
      openNativeCameraFallback();
      if (!mediaDevices) {
        showToast?.({
          type: "warning",
          title: "Câmera",
          message: "Este navegador não oferece câmera direta. Tentando abrir a câmera do sistema.",
        });
      }
      return;
    }

    setCameraCaptureOpen(true);
    setCameraCaptureStarting(true);
    setCameraCaptureError("");
    stopCameraStream();

    try {
      let stream;
      try {
        stream = await mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { exact: "environment" } },
        });
      } catch (err) {
        const name = String(err?.name || "");
        if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") throw err;
        stream = await mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
      }

      cameraStreamRef.current = stream;
      const video = cameraVideoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          /* Chrome Android às vezes inicia após o primeiro frame. */
        }
      }
      setCameraCaptureStarting(false);
    } catch (err) {
      stopCameraStream();
      setCameraCaptureOpen(false);
      setCameraCaptureStarting(false);
      const name = String(err?.name || "");
      const message =
        name === "NotAllowedError"
          ? "Permissão negada. Toque no cadeado do navegador e permita a câmera para este site."
          : name === "NotFoundError"
            ? "Nenhuma câmera foi encontrada neste dispositivo."
            : "Não foi possível acessar a câmera. Verifique as permissões do navegador.";
      showToast?.({ type: "error", title: "Câmera", message });
    }
  }, [
    closeSavedReplies,
    conversaId,
    isRecording,
    openNativeCameraFallback,
    podeEnviar,
    sending,
    showToast,
    stopCameraStream,
  ]);

  const handleCaptureCameraPhoto = useCallback(() => {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraCaptureError("A câmera ainda não está pronta.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraCaptureError("Não foi possível capturar a foto.");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraCaptureError("Não foi possível capturar a foto.");
          return;
        }
        const file = new File([blob], `camera-${Date.now()}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        closeCameraCapture();
        onCameraCaptureFile?.(file);
      },
      "image/jpeg",
      0.92
    );
  }, [closeCameraCapture, onCameraCaptureFile]);

  const handleStartRecording = useCallback(async () => {
    // Gravação NÃO depende de `sending`: ao parar/enviar um áudio, o microfone é liberado na
    // hora para o próximo (o envio segue em fila sequencial no ConversaView). Só bloqueia se já
    // estiver gravando ou sem conversa.
    if (!conversaId || isRecording) return;
    if (!podeEnviar) {
      showToast?.({
        type: "warning",
        title: "Conversa não assumida",
        message: "Clique em Assumir para enviar mensagens.",
      });
      return;
    }
    // Fecha o teclado ao iniciar a gravação. O botão de mic usa preventDefault no mousedown (para
    // não roubar foco/piscar), então o teclado NÃO fecha sozinho — fechamos aqui, de forma suave.
    // Em telas touch, focusInput() só refoca se o input já estiver focado, então o teclado não
    // reabre sozinho durante a gravação (a área de gravação continua visível acima do teclado fechado).
    try {
      const inputEl = inputRef.current;
      if (inputEl && document.activeElement === inputEl) inputEl.blur();
    } catch {
      /* ignore */
    }
    setRecordingSeconds(0);
    try {
      if (!window.isSecureContext) {
        showToast?.({
          type: "error",
          title: "Microfone",
          message: "Para gravar áudio, acesse via HTTPS (ou localhost). Em HTTP o navegador bloqueia o microfone.",
        });
        return;
      }
      if (!isMicSupported()) {
        showToast?.({
          type: "error",
          title: "Microfone",
          message: "Seu navegador não suporta gravação de áudio (getUserMedia indisponível).",
        });
        return;
      }

      const permState = await queryMicPermissionState();
      if (permState === "denied") {
        showToast?.({
          type: "error",
          title: "Microfone bloqueado",
          message: "O microfone está bloqueado para este site. Clique no cadeado do navegador e permita o microfone.",
        });
        return;
      }

      const stream = await acquireMicStream();
      if (await shouldShowMicPersistenceHint()) {
        showToast?.({
          type: "info",
          title: "Permissão do microfone",
          message:
            "O navegador liberou o microfone, mas não confirmou permissão permanente. Para não pedir de novo ao sair e entrar, abra o cadeado/permissões do site e marque Microfone como Permitir.",
        });
      }

      const mimeType = pickRecordingMimeType();

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      // Estado ISOLADO por gravação: cada MediaRecorder tem seu próprio buffer de chunks e seus
      // próprios marcadores de tempo/cancelamento (guardados na instância). Sem isto, ao gravar
      // vários áudios em sequência, o `onstop` (assíncrono) de uma gravação lia/limpava o buffer
      // COMPARTILHADO de outra — resultado: o segundo áudio sumia (chunks vazios → return) ou saía
      // truncado (o back-end recusava o transcode com "não foi possível processar"). Agora cada
      // gravação é independente; iniciar a próxima antes de a anterior finalizar é seguro.
      const localChunks = [];
      const localStartedAt = Date.now();
      recorder.__zapStartedAt = localStartedAt;
      recorder.__zapStopAt = 0;
      recorder.__zapCanceled = false;

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) localChunks.push(e.data);
      };

      recorder.onstop = async () => {
        const wasCanceled = recorder.__zapCanceled === true;
        const chunks = localChunks.slice();
        const startedAt = recorder.__zapStartedAt || localStartedAt;
        const stoppedAt = recorder.__zapStopAt || Date.now();
        const elapsedMs = Math.max(0, stoppedAt - startedAt);
        if (wasCanceled || chunks.length === 0) return;
        const finalType = recorder.mimeType || mimeType || "audio/webm";
        const ext = audioExtensionFromMime(finalType);
        const blob = new Blob(chunks, { type: finalType });
        if (elapsedMs < RECORDED_AUDIO_MIN_MS || blob.size < RECORDED_AUDIO_MIN_BYTES) {
          showToast?.({
            type: "warning",
            title: "Áudio muito curto",
            message: "Grave por pelo menos 1 segundo antes de enviar.",
          });
          return;
        }
        if (elapsedMs > RECORDED_AUDIO_MAX_MS) {
          showToast?.({
            type: "warning",
            title: "Audio muito longo",
            message: "Envie audios de ate 10 minutos.",
          });
          return;
        }
        const meta = await inspectRecordedAudioBlob(blob);
        // NÃO bloquear por "decode_error": o elemento <audio> falha em decodificar o webm/opus (e o
        // mp4 do iOS) do MediaRecorder em muitos navegadores MESMO com áudio válido — isso causava
        // rejeição falsa ("Audio invalido"). A decodificação aqui é só para medir a duração (fallback
        // para o tempo medido). Os testes de tamanho/duração acima já barram gravação vazia/curta, e o
        // backend transcodifica e recusa com erro claro se o áudio estiver realmente quebrado.
        if (meta.error === "decode_error") {
          console.warn("[audio] <audio> não decodificou a gravação; usando duração medida e enviando mesmo assim.");
        }
        const durationMs = Number.isFinite(meta.durationSec)
          ? Math.round(meta.durationSec * 1000)
          : elapsedMs;
        if (Number.isFinite(durationMs) && durationMs < RECORDED_AUDIO_MIN_MS) {
          showToast?.({
            type: "warning",
            title: "Audio muito curto",
            message: "Grave por pelo menos 1 segundo antes de enviar.",
          });
          return;
        }
        if (Number.isFinite(durationMs) && durationMs > RECORDED_AUDIO_MAX_MS + 5000) {
          showToast?.({
            type: "warning",
            title: "Audio muito longo",
            message: "Envie audios de ate 10 minutos.",
          });
          return;
        }
        const file = attachRecordedAudioMetadata(
          new File([blob], `audio-${Date.now()}.${ext}`, {
            type: finalType,
            lastModified: Date.now(),
          }),
          {
            durationMs,
            elapsedMs,
            mimeType: finalType,
            bytes: blob.size,
          }
        );
        await onSendAudioFile?.(file);
      };

      recorder.start(400);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      console.error("Erro ao iniciar gravação:", err);
      const name = String(err?.name || "");
      if (name === "NotAllowedError" || name === "NotFoundError") {
        invalidateMicStream();
      }
      const msg =
        name === "NotAllowedError"
          ? "Permissão negada. Clique no cadeado do navegador e permita o microfone."
          : name === "NotFoundError"
            ? "Nenhum microfone foi encontrado no dispositivo."
            : "Não foi possível acessar o microfone. Verifique as permissões.";
      showToast?.({
        type: "error",
        title: "Microfone",
        message: msg,
      });
    }
  }, [conversaId, isRecording, onSendAudioFile, showToast, podeEnviar]);

  const handleStopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && isRecording) {
      rec.__zapStopAt = Date.now();
      try {
        if (rec.state !== "inactive") {
          rec.requestData?.();
          rec.stop();
        }
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setRecordingSeconds(0);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [isRecording]);

  const filteredRecentStickers = useMemo(
    () =>
      recentStickers.filter((item) => {
        if (!safeString(stickerQuery)) return true;
        return safeString(item?.name).toLowerCase().includes(safeString(stickerQuery).toLowerCase());
      }),
    [recentStickers, stickerQuery]
  );

  const hasDraft = Boolean(safeString(texto).trim());

  const autoAssumirText =
    "Envie uma mensagem para assumir esta conversa e iniciar o atendimento.";

  const placeholderText = autoAssumirHint
    ? autoAssumirText
    : podeEnviar
      ? "Digite uma mensagem"
    : atendimentoEncerradoHint
      ? "Reabra o atendimento para enviar mensagens"
      : mensagensBloqueadasHint
        ? "Este atendimento foi assumido por outro usuário."
        : "Assuma esta conversa para responder";

  const inputAriaLabel = autoAssumirHint
    ? autoAssumirText
    : podeEnviar
      ? composerEnterInsertsNewline
      ? "Digite sua resposta. Retorno ou Enter para nova linha; use o botão enviar para mandar a mensagem. Esc para fechar painéis."
      : "Digite sua resposta. Enter para enviar, Shift+Enter para nova linha, Esc para fechar painéis."
    : atendimentoEncerradoHint
      ? "Reabra o atendimento para enviar mensagens."
      : mensagensBloqueadasHint
        ? "Este atendimento foi assumido por outro usuário. Você não pode enviar mensagens."
        : "Assuma esta conversa para responder.";

  const footerHint = autoAssumirHint
    ? null
    : !podeEnviar
      ? atendimentoEncerradoHint
      ? "Reabra o atendimento para enviar mensagens"
      : mensagensBloqueadasHint
        ? `Este atendimento foi assumido por ${atendenteNomeHint?.trim() ? atendenteNomeHint : "outro usuário"}.`
        : "Assuma esta conversa para enviar mensagens"
    : null;

  const composerPlaceholderText = atendimentoEncerradoHint && !podeEnviar
    ? "Reabra o atendimento para enviar mensagens"
    : placeholderText;
  const composerInputAriaLabel = atendimentoEncerradoHint && !podeEnviar
    ? "Reabra o atendimento para enviar mensagens."
    : inputAriaLabel;
  const composerFooterHint = atendimentoEncerradoHint && !podeEnviar
    ? "Reabra o atendimento para enviar mensagens"
    : footerHint;

  const attachMenuItems = (
    <>
      <div className="wa-attachMenu-head">
        <button
          type="button"
          className="wa-attachMenu-close wa-iconBtn"
          aria-label="Fechar opções"
          title="Fechar"
          onClick={() => setAttachMenuOpen(false)}
        >
          <IconClose />
        </button>
      </div>
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          openSavedRepliesPicker();
        }}
        disabled={sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-savedReplies" aria-hidden="true">
          <IconSavedReplies />
        </span>
        <span>Respostas salvas</span>
      </button>
      <div className="wa-attachDivider" role="separator" />
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          openFototecaPicker();
          setAttachMenuOpen(false);
        }}
        disabled={sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-doc" aria-hidden="true">
          <IconPhoto size={16} strokeWidth={1.6} />
        </span>
        <span>Fototeca/Galeria</span>
      </button>
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          openFototecaPicker();
          setAttachMenuOpen(false);
        }}
        disabled={sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-gallery" aria-hidden="true">
          <IconLayoutGrid size={16} strokeWidth={1.6} />
        </span>
        <span>Galeria</span>
      </button>
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={handleOpenCameraCapture}
        disabled={sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-camera" aria-hidden="true">
          <TablerCamera size={16} strokeWidth={1.6} />
        </span>
        <span>Câmera</span>
      </button>
      <div className="wa-attachDivider" role="separator" />
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          documentInputRef.current?.click();
          setAttachMenuOpen(false);
        }}
        disabled={sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-document" aria-hidden="true">
          <IconFileText size={16} strokeWidth={1.6} />
        </span>
        <span>Documentos</span>
      </button>
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          onPixMenuClick?.();
          setAttachMenuOpen(false);
        }}
        disabled={pixActionBusy || sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-pix" aria-hidden="true">
          <IconPix />
        </span>
        <span>{pixActionBusy ? "Enviando Pix..." : "Pix"}</span>
      </button>
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          setAttachMenuOpen(false);
          onOpenPixConfig?.();
        }}
        disabled={pixConfigLoading || sending}
      >
        <span className="wa-attachItem-icon wa-attachIcon-clip" aria-hidden="true">
          <IconSettings2 size={16} strokeWidth={1.6} />
        </span>
        <span>Configurar Pix</span>
      </button>
      <div className="wa-attachDivider" role="separator" />
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          onShareContact?.();
          setAttachMenuOpen(false);
        }}
        disabled={sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-contact" aria-hidden="true">
          <IconUser size={16} strokeWidth={1.6} />
        </span>
        <span>Contato</span>
      </button>
      <button
        type="button"
        className="wa-attachItem"
        role="menuitem"
        onClick={() => {
          onShareLocation?.();
          setAttachMenuOpen(false);
        }}
        disabled={sending || !conversaId || !podeEnviar}
      >
        <span className="wa-attachItem-icon wa-attachIcon-location" aria-hidden="true">
          <IconMapPin size={16} strokeWidth={1.6} />
        </span>
        <span>Localização</span>
      </button>
      {autocorrectToggleInMenu ? (
        <button
          type="button"
          className="wa-attachItem wa-attachItem--autocorrect"
          role="menuitemcheckbox"
          aria-checked={autoCorrectEnabled ? "true" : "false"}
          onClick={() => {
            updateAutoCorrectPreference(!autoCorrectEnabled);
            setAttachMenuOpen(false);
          }}
        >
          <span className="wa-attachItem-icon wa-attachIcon-clip" aria-hidden="true">
            ✓
          </span>
          <span>
            {autoCorrectEnabled ? "Desativar correção automática" : "Ativar correção automática"}
          </span>
        </button>
      ) : null}
    </>
  );

  return (
    <>
      <div className="wa-composerStack">
      {showScrollToRecent && !isRecording ? (
        <button
          type="button"
          className="wa-scrollRecentBtn"
          // preventDefault no mousedown: não rouba o foco do input (não fecha/reabre o teclado só por tocar no botão).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onScrollToRecent?.()}
          aria-label="Ir para as mensagens mais recentes"
          title="Mensagens mais recentes"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              d="M7 10l5 5 5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
      {savedRepliesOpen && !isRecording ? (
        <div
          ref={savedRepliesPanelRef}
          className="wa-savedRepliesPanel"
          role="listbox"
          aria-label="Respostas salvas"
        >
          <div className="wa-savedRepliesPanel-head">
            <span className="wa-savedRepliesPanel-title">Respostas salvas</span>
            <span className="wa-muted wa-savedRepliesPanel-hint">↑↓ navegar · Enter inserir · Esc fechar</span>
          </div>
          <div className="wa-savedRepliesPanel-body">
            {savedRepliesLoading ? (
              <div className="wa-muted">Carregando...</div>
            ) : savedRepliesError ? (
              <div className="wa-muted" role="status">{savedRepliesError}</div>
            ) : filteredSavedReplies.length === 0 ? (
              <div className="wa-muted wa-savedRepliesPanel-empty">
                {savedRepliesList.length === 0 ? (
                  <>
                    <p>Nenhuma resposta salva pessoal.</p>
                    <p className="wa-savedRepliesPanel-empty-hint">
                      Cadastre em <strong>Configurações → Respostas salvas</strong> (não confundir com
                      &quot;Respostas automáticas&quot; do Bot em IA).
                    </p>
                  </>
                ) : (
                  "Nenhuma resposta encontrada para esta busca."
                )}
              </div>
            ) : (
              <div className="wa-savedRepliesList">
                {filteredSavedReplies.map((r, idx) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`wa-savedReplyItem ${idx === savedRepliesIndex ? "isActive" : ""}`}
                    role="option"
                    aria-selected={idx === savedRepliesIndex ? "true" : "false"}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertSavedReply(r.texto)}
                    title={r.titulo}
                  >
                    <strong>{r.titulo}</strong>
                    <span className="wa-muted wa-savedReplyItem-preview">
                      {String(r.texto || "").slice(0, 80)}
                      {(r.texto || "").length > 80 ? "…" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {replyBarPreview && !isRecording ? (
        <div className="wa-replyBar" role="region" aria-label="Respondendo">
          <div className="wa-replyBar-bar" aria-hidden="true" />
          {replyBarPreview.thumb ? (
            <img
              src={replyBarPreview.thumb}
              alt=""
              className="wa-replyBar-thumb"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <div className="wa-replyBar-left">
            <div className="wa-replyBar-title">{replyBarPreview.title}</div>
            <div className="wa-replyBar-text">{replyBarPreview.text}</div>
          </div>
          <button
            type="button"
            className="wa-iconBtn"
            onClick={onCancelReply}
            title="Cancelar resposta"
            aria-label="Cancelar resposta"
            disabled={sending}
          >
            <IconClose />
          </button>
        </div>
      ) : null}

      <div className="wa-footer">
        {isRecording ? (
          <div className="wa-recording-bar">
            <button
              type="button"
              className="wa-recording-cancel"
              onClick={handleCancelRecording}
              title="Cancelar"
              aria-label="Cancelar gravação"
            >
              <IconClose />
            </button>
            <div className="wa-recording-timer">
              <span className="wa-recording-dot" aria-hidden="true" />
              <span className="wa-recording-time">
                {Math.floor(recordingSeconds / 60)}:{(recordingSeconds % 60).toString().padStart(2, "0")}
              </span>
            </div>
            <span className="wa-recording-hint">Toque para enviar</span>
            <button
              type="button"
              className="wa-recording-send"
              onClick={handleStopRecording}
              title="Enviar áudio"
              aria-label="Enviar áudio"
            >
              <IconSend />
            </button>
          </div>
        ) : (
          <>
            {composerFooterHint ? (
              <div className="wa-footer-hint" role="status">
                {composerFooterHint}
              </div>
            ) : null}
            <div className="wa-attachWrap" ref={attachMenuRef}>
              <button
                type="button"
                className={`wa-iconBtn wa-attachPlus ${attachMenuOpen ? "isOpen" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  closeSavedReplies();
                  setAttachMenuOpen((v) => !v);
                  setEmojiOpen(false);
                  setStickerOpen(false);
                }}
                title="Anexos e mais"
                aria-label="Anexos e mais"
                aria-expanded={attachMenuOpen}
                disabled={sending || !conversaId || !podeEnviar}
              >
                <IconPlus />
              </button>
              {attachMenuOpen
                ? attachMenuPortal && typeof document !== "undefined"
                  ? createPortal(
                      <>
                        <button
                          type="button"
                          className="wa-attachBackdrop wa-attachBackdrop--portal"
                          aria-label="Fechar opções de anexo"
                          onClick={() => setAttachMenuOpen(false)}
                        />
                        <div
                          ref={attachMenuPanelRef}
                          className="wa-attachMenu wa-attachMenu--portal"
                          role="menu"
                          aria-label="Anexos"
                        >
                          {attachMenuItems}
                        </div>
                      </>,
                      document.body
                    )
                  : (
                    <div
                      ref={attachMenuPanelRef}
                      className="wa-attachMenu"
                      role="menu"
                      aria-label="Anexos"
                    >
                      {attachMenuItems}
                    </div>
                  )
                : null}
            </div>
            <div className="wa-stickerWrap">
              <button
                ref={stickerBtnRef}
                type="button"
                className={`wa-iconBtn wa-stickerBtn ${stickerOpen ? "isActive" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  closeSavedReplies();
                  setStickerOpen((v) => !v);
                  setAttachMenuOpen(false);
                  setEmojiOpen(false);
                }}
                title="Figurinhas"
                aria-label="Figurinhas"
                aria-expanded={stickerOpen}
                disabled={sending || !conversaId || !podeEnviar}
              >
                <IconSticker />
              </button>
            </div>
            {!autocorrectToggleInMenu ? (
              <label
                className={`wa-autocorrectToggle ${autoCorrectEnabled ? "isEnabled" : ""}`}
                title="Ativar ou desativar correção ortográfica automática"
              >
                <input
                  type="checkbox"
                  checked={autoCorrectEnabled}
                  onChange={(e) => updateAutoCorrectPreference(e.target.checked)}
                  aria-label="Correção automática"
                />
                <span className="wa-autocorrectToggle-track" aria-hidden="true">
                  <span className="wa-autocorrectToggle-thumb" />
                </span>
                <span className="wa-autocorrectToggle-text">Correção automática</span>
              </label>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              accept=".pdf,.doc,.docx,image/*,audio/*,video/*"
              onChange={onFileInputChange}
            />
            <input
              ref={fototecaInputRef}
              type="file"
              style={{ display: "none" }}
              accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,image/heic,image/heif,video/mp4,video/webm,video/3gpp,video/quicktime,video/x-msvideo"
              multiple
              onChange={onFototecaInputChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              style={{ display: "none" }}
              accept="image/*"
              capture="environment"
              onChange={onCameraInputChange}
            />
            <input
              ref={audioInputRef}
              type="file"
              style={{ display: "none" }}
              accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.opus,.webm"
              onChange={onFileInputChange}
            />
            <input
              ref={documentInputRef}
              type="file"
              style={{ display: "none" }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.html,.htm,.rtf,.zip,.rar,.7z,.xml,.json,.sql,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,text/markdown,text/html,application/rtf,application/zip,application/x-zip-compressed,application/vnd.rar,application/x-rar-compressed,application/x-7z-compressed,application/xml,text/xml,application/json,application/sql"
              multiple
              onChange={onDocumentInputChange}
            />
            <input
              ref={stickerInputRef}
              type="file"
              style={{ display: "none" }}
              accept="image/*"
              onChange={onStickerInputChange}
            />

            <textarea
              ref={inputRef}
              value={texto}
              onChange={handleInputChange}
              onBlur={emitTypingStop}
              onPaste={handlePaste}
              placeholder={composerPlaceholderText}
              className={`wa-input ${autoCorrectFlash ? "wa-input--autocorrect-flash" : ""} ${atendimentoEncerradoHint && !podeEnviar ? "wa-input--closedAttendance" : ""}`}
              onKeyDown={handleKeyDownInput}
              disabled={!conversaId || !podeEnviar}
              aria-label={composerInputAriaLabel}
              rows={1}
              enterKeyHint={composerEnterInsertsNewline ? "enter" : "send"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />

            {!headerCompact ? (
              <button
                type="button"
                className={`wa-iconBtn ${emojiOpen ? "isActive" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  closeSavedReplies();
                  setEmojiOpen((v) => !v);
                  setAttachMenuOpen(false);
                  setStickerOpen(false);
                }}
                title="Emojis"
                aria-label="Emojis"
                disabled={sending || !conversaId || !podeEnviar}
              >
                <IconEmoji />
              </button>
            ) : null}

            {headerCompact && !hasDraft ? (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleOpenCameraCapture}
                disabled={sending || !conversaId || !podeEnviar}
                className="wa-iconBtn wa-cameraQuickBtn"
                title="Câmera"
                type="button"
                aria-label="Abrir câmera"
              >
                <IconCamera />
              </button>
            ) : null}

            <div className="wa-footer-right">
              {headerCompact ? (
                hasDraft ? (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                    }}
                    onClick={() => handleSendFromComposer(texto)}
                    disabled={!hasDraft || !conversaId || !podeEnviar || sending}
                    className="wa-sendBtn"
                    title="Enviar"
                    aria-label="Enviar mensagem"
                  >
                    <IconSend />
                  </button>
                ) : (
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleStartRecording}
                    disabled={!conversaId || !podeEnviar}
                    className="wa-micBtn"
                    title="Gravar áudio"
                    type="button"
                    aria-label="Gravar áudio"
                  >
                    <IconMic />
                  </button>
                )
              ) : (
                <>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleStartRecording}
                    disabled={!conversaId || !podeEnviar}
                    className="wa-micBtn"
                    title="Gravar áudio"
                    type="button"
                    aria-label="Gravar áudio"
                  >
                    <IconMic />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                    }}
                    onClick={() => handleSendFromComposer(texto)}
                    disabled={!hasDraft || !conversaId || !podeEnviar || sending}
                    className="wa-sendBtn"
                    title="Enviar"
                    aria-label="Enviar mensagem"
                  >
                    <IconSend />
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      </div>

      {cameraCaptureOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="wa-cameraCapture" role="dialog" aria-modal="true" aria-label="Câmera">
              <div className="wa-cameraCapture-stage">
                <video
                  ref={cameraVideoRef}
                  className="wa-cameraCapture-video"
                  playsInline
                  muted
                  autoPlay
                />
                {cameraCaptureStarting ? (
                  <div className="wa-cameraCapture-status" role="status">
                    Abrindo câmera...
                  </div>
                ) : null}
                {cameraCaptureError ? (
                  <div className="wa-cameraCapture-error" role="alert">
                    {cameraCaptureError}
                  </div>
                ) : null}
              </div>
              <canvas ref={cameraCanvasRef} className="wa-cameraCapture-canvas" aria-hidden="true" />
              <div className="wa-cameraCapture-actions">
                <button
                  type="button"
                  className="wa-cameraCapture-close wa-iconBtn"
                  onClick={closeCameraCapture}
                  title="Cancelar"
                  aria-label="Cancelar câmera"
                >
                  <IconClose />
                </button>
                <button
                  type="button"
                  className="wa-cameraCapture-shot"
                  onClick={handleCaptureCameraPhoto}
                  disabled={cameraCaptureStarting}
                  title="Tirar foto"
                  aria-label="Tirar foto"
                >
                  <span aria-hidden="true" />
                </button>
              </div>
            </div>,
            document.body
          )
        : null}

      {!isRecording && stickerOpen
        ? createPortal(
            <div ref={stickerPanelRef} className="wa-stickerPanel" role="dialog" aria-label="Figurinhas">
              <div className="wa-stickerTabs" role="tablist" aria-label="Categorias de figurinhas">
                <button type="button" className="wa-stickerTab isActive" role="tab" aria-selected="true">
                  Recentes
                </button>
              </div>
              <div className="wa-stickerHead">
                <input
                  ref={stickerSearchRef}
                  className="wa-stickerSearch"
                  value={stickerQuery}
                  onChange={(e) => setStickerQuery(e.target.value)}
                  placeholder="Buscar figurinha..."
                  aria-label="Buscar figurinha"
                />
              </div>
              <div className="wa-stickerGrid" role="list">
                <button
                  type="button"
                  className="wa-stickerCreate"
                  onClick={() => stickerInputRef.current?.click()}
                  aria-label="Criar figurinha"
                >
                  <span className="wa-stickerCreatePlus" aria-hidden="true">
                    +
                  </span>
                  <span>Criar</span>
                </button>
                {filteredRecentStickers.map((item) => (
                  <button
                    key={String(item.id)}
                    type="button"
                    className="wa-stickerItem"
                    onClick={async () => {
                      try {
                        const res = await fetch(item.dataUrl);
                        const blob = await res.blob();
                        const ext = String(item?.mimeType || "").includes("webp") ? "webp" : "png";
                        const file = new File([blob], item?.name || `sticker-${Date.now()}.${ext}`, {
                          type: item?.mimeType || blob.type || "image/webp",
                        });
                        await onSendStickerFile?.(file);
                      } catch {
                        showToast?.({
                          type: "error",
                          title: "Figurinha",
                          message: "Não foi possível enviar esta figurinha.",
                        });
                      }
                    }}
                    role="listitem"
                    aria-label={`Enviar figurinha ${item?.name || ""}`.trim()}
                    title={item?.name || "Figurinha"}
                  >
                    <img src={item.dataUrl} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )
        : null}

      {!isRecording && emojiOpen
        ? createPortal(
            <div ref={emojiPanelRef} className="wa-emojiPanel" role="dialog" aria-label="Selecionar emoji">
              <div className="wa-emojiHead">
                <input
                  ref={emojiSearchRef}
                  className="wa-emojiSearch"
                  value={emojiQuery}
                  onChange={(e) => setEmojiQuery(e.target.value)}
                  placeholder="Buscar emoji..."
                  aria-label="Buscar emoji"
                />
                <button
                  type="button"
                  className="wa-iconBtn"
                  onClick={() => {
                    setEmojiOpen(false);
                    setEmojiQuery("");
                  }}
                  title="Fechar"
                  aria-label="Fechar"
                >
                  <IconClose />
                </button>
              </div>
              <div className="wa-emojiGrid" role="list">
                {__WA_EMOJIS.filter((e) => !safeString(emojiQuery) || e.includes(safeString(emojiQuery))).map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="wa-emojiBtn"
                    onClick={() => insertEmoji(e)}
                    role="listitem"
                    aria-label={`Emoji ${e}`}
                    title={e}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="wa-emojiFoot">
                <span className="wa-muted">Dica: clique para inserir no cursor.</span>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
});

export default memo(ConversaComposer, composerPropsAreEqual);
