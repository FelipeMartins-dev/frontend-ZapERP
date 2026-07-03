import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { shallow } from "zustand/shallow";
import { useConversaStore, getMessageListReactKey, isPendingOutgoingTemp } from "./conversaStore";
import {
  enviarMensagem,
  excluirMensagem,
  enviarReacao,
  removerReacao,
  registrarLigacao,
  listarAtendentesDisponiveisConversa,
  adicionarAtendenteConversa,
} from "./conversaService";
import {
  isGroupConversation,
  getStatusAtendimentoEffective,
  isClosedAttendance,
  exibirBadgePagamentoConcluido,
  resolveContactMetaFromMessage,
} from "../utils/conversaUtils";
import "./conversa.css";
import "../styles/zap-animations.css";
import api from "../api/http";
import { useAuthStore } from "../auth/authStore";
import { canAssumir, canReabrir, canTag, canTransferirSetorConversa } from "../auth/permissions";
const ProdutoConsultaPanel = lazy(() => import("./ProdutoConsultaPanel"));
const SidebarCliente = lazy(() => import("./SidebarCliente"));
const ForwardModal = lazy(() => import("./components/ForwardModal"));
const ShareContactModal = lazy(() => import("./components/ShareContactModal"));
const ShareLocationModal = lazy(() => import("./components/ShareLocationModal"));
const PixConfigModal = lazy(() => import("./components/PixConfigModal"));
const MsgInfoModal = lazy(() => import("./components/MsgInfoModal"));
const CallModal = lazy(() => import("./components/CallModal"));
const AddToGroupModal = lazy(() => import("./components/AddToGroupModal"));
const MediaViewerOverlay = lazy(() => import("./components/MediaViewerOverlay"));
import { abrirConversaPorTelefone, carregarMensagensAntigasContato, conversaFromContatoResponse, fetchChats } from "../chats/chatService";
import { getDisplayName } from "../chats/chatListDisplay";
import { getSocket } from "../socket/socket";
import { scheduleAfterInitialPaint } from "../chats/scheduleAfterInitialPaint";
import { saveReplyMeta } from "./replyMeta";
import {
  buildOptimisticOutgoingMessage,
  bumpChatListWithOptimisticMessage,
  extractArquivoApiFailures,
  extractArquivoApiReconciliations,
  normalizeArquivoApiToMessage,
  normalizeTextSendApiToMessage,
} from "./conversaOptimisticMessage";
import {
  isNearBottom,
  captureMessagesScrollAnchor,
  restoreMessagesScrollAnchor,
} from "./scrollUtils";
import ConversaThread from "./ConversaThread";
import ConversaComposer from "./ConversaComposer";

import { FORWARD_SELECT_MAX, MAX_DOCUMENTOS_LOTE_ENVIO, STICKER_RECENTS_LIMIT } from "./conversaConstants";
import {
  parseToDate,
  formatDia,
  sameDay,
  safeString,
  isFilenameOnlyText,
  isOutgoingMessage,
  isMediaCaptionBundleTop,
  isPlainCaptionFollowMessage,
  mediaHasInlineCaption,
  captionTextsEquivalent,
  messageHasReplyMeta,
  sameCaptionBundleAuthor,
  captionFollowTimeOk,
  formatHoraCurta,
  timelineEventLabel,
  initials,
  statusBadge,
  isImageFile,
  isAudioFile,
  isVideoFile,
  isArquivoBloqueadoWhatsApp,
  mensagemArquivoBloqueadoWhatsApp,
  getMediaUrl,
  fileToPreviewURL,
  getAudioFilename,
  readRecentStickers,
  writeRecentStickers,
  toDataUrl,
  convertImageToWebp,
  isRichMediaMessage,
  resolveConversaAvatarUrl,
} from "./utils/conversaViewHelpers";
import { renderTextWithLinks } from "./utils/conversaViewFormat";
import {
  snippetFromMsg,
  pickReplyToIdForApi,
  buildReplyMetaForPersist,
  replySnippetDisplay,
  getReplySenderLabel,
} from "./utils/conversaMessageDisplay";
import {
  IconClose,
  ChatToast,
} from "./conversaViewIcons";
import Bubble from "./ConversaBubble";
import { useStableTimeout } from "./hooks/useStableTimeout";
import { useAutoScroll, snapThreadToBottom } from "./hooks/useAutoScroll";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";
import { useForwardFlow } from "./hooks/useForwardFlow";
import { useMediaViewer } from "./hooks/useMediaViewer";
import { usePixConfig } from "./hooks/usePixConfig";
import { useShareContact } from "./hooks/useShareContact";
import { useShareLocation } from "./hooks/useShareLocation";
import ConversaSelectionBar from "./components/ConversaSelectionBar";
import PendingMediaPreview from "./components/PendingMediaPreview";
import ConversaHeader from "./components/ConversaHeader";
import ConversaMessageSearchPanel from "./components/ConversaMessageSearchPanel";

import { useChatStore } from "../chats/chatsStore";
import { useWhatsappInstancesStore } from "../chats/whatsappInstancesStore";
import {
  listarTags,
  adicionarTagConversa,
  removerTagConversa,
} from "../api/tagService";
import { useMatchMedia } from "../hooks/useMatchMedia";
import EmptyState from "../components/feedback/EmptyState";
import ConversaLoadingScreen from "./ConversaLoadingScreen";
import "../components/feedback/empty-state.css";
import "../components/feedback/skeleton.css";
import "../components/feedback/toast.css";




/* =========================================================
   Hooks
========================================================= */

function normalizeDepartamentoIdForAccess(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value).trim();
}

function getUserDepartamentoIdSet(user) {
  const ids = [];
  if (Array.isArray(user?.departamento_ids)) ids.push(...user.departamento_ids);
  if (user?.departamento_id != null) ids.push(user.departamento_id);
  if (Array.isArray(user?.departamentos)) {
    for (const dep of user.departamentos) {
      ids.push(dep?.id ?? dep?.departamento_id ?? dep);
    }
  }

  const set = new Set();
  for (const id of ids) {
    const normalized = normalizeDepartamentoIdForAccess(id);
    if (normalized) set.add(normalized);
  }
  return set;
}


function ConversaViewBody() {
  const {
    conversa,
    mensagens,
    loading,
    loadError,
    loadingMore,
    hasMore,
    cursor,
  } = useConversaStore(
    (s) => ({
      conversa: s.conversa,
      mensagens: s.mensagens,
      loading: s.loading,
      loadError: s.loadError,
      loadingMore: s.loadingMore,
      hasMore: s.hasMore,
      cursor: s.cursor,
    }),
    shallow
  );

  const { tags, atendimentos, atendimentosLoading } = useConversaStore(
    (s) => ({
      tags: s.tags,
      atendimentos: s.atendimentos,
      atendimentosLoading: s.atendimentosLoading,
    }),
    shallow
  );

  const selectedId = useConversaStore((s) => s.selectedId);
  const setSelectedId = useConversaStore((s) => s.setSelectedId);

  /** Só a entrada da conversa atual — não re-renderiza quando outro chat recebe typing_start. */
  const typingInfo = useConversaStore((s) => {
    const id = s.conversa?.id ?? s.selectedId;
    if (id == null || id === "") return null;
    return s.typing[String(id)] ?? null;
  });

  const {
    refresh,
    loadMore,
    carregarConversa,
    anexarMensagem,
    anexarMensagemImediata,
    reconciliarMensagem,
    marcarMensagemApagadaParaTodos,
    removerMensagem,
    removerMensagemTemp,
    marcarMensagemTempErro,
    carregarAtendimentos,
    clearTyping,
    assumirConversa,
    reabrirConversa,
    setTags,
  } = useConversaStore(
    (s) => ({
      refresh: s.refresh,
      loadMore: s.loadMore,
      carregarConversa: s.carregarConversa,
      anexarMensagem: s.anexarMensagem,
      anexarMensagemImediata: s.anexarMensagemImediata,
      reconciliarMensagem: s.reconciliarMensagem,
      marcarMensagemApagadaParaTodos: s.marcarMensagemApagadaParaTodos,
      removerMensagem: s.removerMensagem,
      removerMensagemTemp: s.removerMensagemTemp,
      marcarMensagemTempErro: s.marcarMensagemTempErro,
      carregarAtendimentos: s.carregarAtendimentos,
      clearTyping: s.clearTyping,
      assumirConversa: s.assumirConversa,
      reabrirConversa: s.reabrirConversa,
      setTags: s.setTags,
    }),
    shallow
  );

  const user = useAuthStore((s) => s.user);
  const myUserId = user?.id != null && user.id !== "" ? String(user.id) : null;
  const podeTransferirSetor = canTransferirSetorConversa(user);
  const podeGerenciarTags = canTag(user);
  const mostrarEnviarCrm = user?.crm_habilitado !== false;
  const headerCompact = useMatchMedia("(max-width: 640px)");
  /** Tablet atendimento: mesmo padrão do mobile — correção no menu (+), barra em uma linha */
  const atendimentoTabletComposer = useMatchMedia("(min-width: 740px) and (max-width: 1024px)");
  /** Cabeçalho compacto (toolbar ⋯ + ações inline) — mobile e tablet; desktop largo mantém fileira completa */
  const headerAtendCompact = headerCompact || atendimentoTabletComposer;
  /** Bolhas: long press + folha de opções; barra de seleção premium (sem alterar desktop largo). */
  const compactMessageUx = headerCompact || atendimentoTabletComposer;
  const autocorrectToggleInMenu = headerCompact || atendimentoTabletComposer;
  /** Mobile/tablet: tecla Retorno do teclado virtual insere nova linha; enviar só pelo botão (evita enterKeyHint=send esconder o enter). */
  const composerEnterInsertsNewline = headerCompact || atendimentoTabletComposer;
  const composerAppendQueue = useConversaStore((s) => s.composerAppendQueue);
  const clearComposerAppendQueue = useConversaStore((s) => s.clearComposerAppendQueue);
  const queueComposerAppend = useConversaStore((s) => s.queueComposerAppend);

  const conversaElegivelAutoAssumir = useMemo(() => {
    if (!user?.id || !conversa?.id) return false;
    if (!canAssumir(user)) return false;
    if (isGroupConversation(conversa)) return false;
    if (isClosedAttendance(conversa)) return false;
    if (conversa?.mensagens_bloqueadas) return false;

    const atendenteId = conversa?.atendente_id ?? null;
    const departamentoId = normalizeDepartamentoIdForAccess(conversa?.departamento_id);
    const semAtendente = atendenteId == null || atendenteId === "";
    const userRole = String(user?.role || user?.perfil || "").toLowerCase();
    const isPrivileged = userRole === "admin" || userRole === "supervisor";
    const userDepIds = getUserDepartamentoIdSet(user);
    const podeVerSetor =
      isPrivileged ||
      !departamentoId ||
      userDepIds.has(departamentoId);

    return semAtendente && podeVerSetor;
  }, [
    user,
    user?.id,
    user?.role,
    user?.perfil,
    user?.departamento_id,
    user?.departamento_ids,
    user?.departamentos,
    conversa?.id,
    conversa?.remoteJid,
    conversa?.telefone,
    conversa?.phone,
    conversa?.is_group,
    conversa?.isGroup,
    conversa?.tipo,
    conversa?.status_atendimento_real,
    conversa?.status_atendimento,
    conversa?.mensagens_bloqueadas,
    conversa?.atendente_id,
    conversa?.departamento_id,
  ]);

  const conversaElegivelAutoReabrir = useMemo(() => {
    if (!user?.id || !conversa?.id) return false;
    if (!canReabrir(user)) return false;
    if (isGroupConversation(conversa)) return false;
    if (!isClosedAttendance(conversa)) return false;
    if (conversa?.mensagens_bloqueadas) return false;
    return true;
  }, [
    user,
    user?.id,
    user?.role,
    user?.perfil,
    conversa?.id,
    conversa?.remoteJid,
    conversa?.telefone,
    conversa?.phone,
    conversa?.is_group,
    conversa?.isGroup,
    conversa?.tipo,
    conversa?.status_atendimento_real,
    conversa?.status_atendimento,
    conversa?.mensagens_bloqueadas,
  ]);

  const podeEnviar = useMemo(() => {
    if (!user?.id || !conversa?.id) return false;
    /** Grupos: qualquer usuário pode enviar sem assumir atendimento (modelo WhatsApp). */
    if (isGroupConversation(conversa)) return true;
    if (isClosedAttendance(conversa)) return conversaElegivelAutoReabrir;
    if (conversa?.mensagens_bloqueadas) return false;
    const atendenteId = conversa?.atendente_id ?? null;
    if (atendenteId == null || atendenteId === "") return conversaElegivelAutoAssumir;
    return String(atendenteId) === String(user.id);
  }, [
    user?.id,
    conversa?.id,
    conversa?.remoteJid,
    conversa?.telefone,
    conversa?.phone,
    conversa?.is_group,
    conversa?.isGroup,
    conversa?.tipo,
    conversa?.status_atendimento_real,
    conversa?.status_atendimento,
    conversa?.mensagens_bloqueadas,
    conversa?.atendente_id,
    conversaElegivelAutoAssumir,
    conversaElegivelAutoReabrir,
  ]);

  const [showTimeline, setShowTimeline] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingCountRef = useRef(0);
  const setSendingTracked = useCallback((active) => {
    if (active) {
      sendingCountRef.current += 1;
      setSending(true);
    } else {
      sendingCountRef.current = Math.max(0, sendingCountRef.current - 1);
      if (sendingCountRef.current === 0) setSending(false);
    }
  }, []);

  const [toast, setToast] = useState(null);
  const toastT = useStableTimeout();

  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);
  /** Legenda opcional digitada no preview (apenas imagem/vídeo, estilo WhatsApp). */
  const [pendingCaption, setPendingCaption] = useState("");
  const pendingCaptionRef = useRef(null);
  const mediaPreviewRootRef = useRef(null);
  const pendingBlobUrlRef = useRef(null);
  const pendingConversaIdRef = useRef(null);
  const confirmSendLockRef = useRef(false);
  /** Evita POST duplicado do mesmo arquivo (double-click / Enter + botão). */
  const arquivoEnvioInFlightRef = useRef(new Set());
  const [localReactions, setLocalReactions] = useState({});
  const [reactionLoading, setReactionLoading] = useState({});

  const [addToGroupModal, setAddToGroupModal] = useState({ open: false, telefone: null, nome: null });
  const [addToGroupGrupos, setAddToGroupGrupos] = useState([]);
  const [addToGroupLoading, setAddToGroupLoading] = useState(false);
  const [addToGroupSending, setAddToGroupSending] = useState(false);

  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callDuration, setCallDuration] = useState(5);
  const [callSending, setCallSending] = useState(false);
  const messagesContainerRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const messagesLastScrollTopRef = useRef(0);
  /** Bloqueia snap automático ao fundo (Assumir, etc.). */
  const suppressAutoScrollRef = useRef(false);
  /** Enquanto o utilizador arrasta o thread (touch), bloqueia reancoragem programática. */
  const userScrollLockRef = useRef(false);
  const userScrollUnlockTimerRef = useRef(0);
  const userInterruptedOpenSnapRef = useRef(false);
  const cancelOpenSnapPendingRef = useRef(null);
  const messagesScrollPreserveSnapRef = useRef(null);
  const [allTags, setAllTags] = useState([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagMutatingId, setTagMutatingId] = useState(null);
  const [showClienteSide, setShowClienteSide] = useState(false);
  const [showTransferirSetor, setShowTransferirSetor] = useState(false);
  const [departamentos, setDepartamentos] = useState([]);
  const [transferirSetorLoading, setTransferirSetorLoading] = useState(false);
  const [showAdicionarAtendente, setShowAdicionarAtendente] = useState(false);
  const [atendentesDisponiveis, setAtendentesDisponiveis] = useState([]);
  const [atendenteSearch, setAtendenteSearch] = useState("");
  const [atendentesLoading, setAtendentesLoading] = useState(false);
  const [adicionarAtendenteLoadingId, setAdicionarAtendenteLoadingId] = useState(null);
  const [showProdutosPanel, setShowProdutosPanel] = useState(false);

  const userRole = String(user?.role || user?.perfil || "").toLowerCase();
  const canConsultarProdutos = ["admin", "supervisor", "atendente"].includes(userRole);
  const canVerSyncProdutos = ["admin", "supervisor"].includes(userRole);
  const canSincronizarProdutos = userRole === "admin";

  // ações estilo WhatsApp: responder, encaminhar, fixar, favoritar, selecionar, apagar
  const [replyTo, setReplyTo] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState({});
  /** Ordem em que as mensagens foram marcadas (ids como string), para respeitar na API. */
  const [selectionOrder, setSelectionOrder] = useState([]);
  const selectionOrderRef = useRef([]);
  /** True quando o modo seleção foi aberto por "Encaminhar" (mostra fluxo até o destino). */
  const [forwardSelectIntent, setForwardSelectIntent] = useState(false);
  const [pinnedIds, setPinnedIds] = useState([]);
  const [starredIds, setStarredIds] = useState([]);

  const [msgInfoOpen, setMsgInfoOpen] = useState(false);
  const [msgInfo, setMsgInfo] = useState(null);

  const bottomRef = useRef(null);
  const virtualThreadRef = useRef(null);
  const composerRef = useRef(null);
  const mensagensComSeparadoresRef = useRef([]);
  const waShellRef = useRef(null);
  const waHeaderRef = useRef(null);
  const sendCrmRef = useRef(null);
  const zapSeenMsgKeysRef = useRef(new Set());
  const zapMsgsInitialPassRef = useRef(true);

  const focusMessageInput = useCallback(({ force = false } = {}) => {
    composerRef.current?.focusInput?.({ force });
  }, []);

  /** Métricas do composer — scroll ao enviar fica só em useAutoScroll (evita duplo snap). */
  const handleComposerTextMetrics = useCallback(() => {}, []);

  useEffect(() => {
    const currentBlobUrl = pendingPreview || null;
    pendingBlobUrlRef.current = currentBlobUrl;

    return () => {
      if (currentBlobUrl && String(currentBlobUrl).startsWith("blob:")) {
        try {
          URL.revokeObjectURL(currentBlobUrl);
        } catch {
          /* ignore */
        }
      }
    };
  }, [pendingPreview]);

  const conversaId = conversa?.id || null;

  const debugMessageBoundary = useCallback((event, payload = {}) => {
    if (!import.meta?.env?.DEV) return;
    console.debug(`[message-boundary] ${event}`, payload);
  }, []);

  /** Enquanto `carregarConversa` limpa `conversa`, `selectedId` mantém o chat — necessário para scroll até à última mensagem não falhar a meio do load. */
  const scrollThreadId =
    selectedId != null && selectedId !== "" ? selectedId : conversaId;

  useEffect(() => {
    setMessageSearchOpen(false);
  }, [conversaId]);

  /* Mobile: cabeçalho fixo (viewport) + padding no shell; teclado via visualViewport */
  const mobileFullViewportHeightRef = useRef(0);
  const mobileKeyboardWasVisibleRef = useRef(false);

  useLayoutEffect(() => {
    const shell = waShellRef.current;
    const header = waHeaderRef.current;
    if (!shell || !header) return;

    mobileFullViewportHeightRef.current = 0;
    mobileKeyboardWasVisibleRef.current = false;

    const mq = window.matchMedia("(max-width: 640px)");
    const root = document.documentElement;
    const getComposerInput = () => composerRef.current?.getInputElement?.() ?? null;

    const setViewportCssVars = (vars) => {
      for (const [key, value] of Object.entries(vars)) {
        if (value == null) {
          shell.style.removeProperty(key);
          root.style.removeProperty(key);
        } else {
          shell.style.setProperty(key, value);
          root.style.setProperty(key, value);
        }
      }
    };

    const syncComposerHeight = () => {
      const stack = shell.querySelector(".wa-composerStack");
      if (!mq.matches || !stack) {
        setViewportCssVars({ "--wa-composer-stack-h": null });
        return;
      }
      setViewportCssVars({
        "--wa-composer-stack-h": `${Math.ceil(stack.getBoundingClientRect().height)}px`,
      });
    };

    const syncHeaderLayout = () => {
      if (!mq.matches) {
        setViewportCssVars({
          "--wa-mobile-header-h": null,
          "--wa-vv-top": null,
          "--wa-keyboard-inset": null,
          "--wa-visual-height": null,
          "--wa-composer-stack-h": null,
        });
        shell.classList.remove("wa-keyboard-visible");
        mobileKeyboardWasVisibleRef.current = false;
        return;
      }

      shell.style.setProperty("--wa-mobile-header-h", `${header.offsetHeight}px`);
      root.style.setProperty("--wa-mobile-header-h", `${header.offsetHeight}px`);

      const mediaPreviewOpen = Boolean(shell.querySelector(".wa-mediaPreview"));
      if (mediaPreviewOpen) {
        shell.classList.remove("wa-keyboard-visible");
        mobileKeyboardWasVisibleRef.current = false;
        setViewportCssVars({
          "--wa-vv-top": null,
          "--wa-keyboard-inset": null,
          "--wa-visual-height": null,
          "--wa-composer-stack-h": null,
        });
        return;
      }

      const vvNow = window.visualViewport;
      const input = getComposerInput();
      const inputFocused = Boolean(input && document.activeElement === input);

      if (vvNow) {
        const ih = window.innerHeight;
        const visibleH = vvNow.height;
        const kbInset = Math.max(0, ih - visibleH - vvNow.offsetTop);
        if (!inputFocused && kbInset < 48) {
          mobileFullViewportHeightRef.current = Math.max(
            mobileFullViewportHeightRef.current,
            visibleH,
            ih
          );
        }
        const baseline = mobileFullViewportHeightRef.current || ih;
        const keyboardOpen =
          kbInset > 48 || (inputFocused && visibleH < baseline - 72);

        setViewportCssVars({
          "--wa-vv-top": `${vvNow.offsetTop}px`,
          "--wa-keyboard-inset": `${kbInset}px`,
          "--wa-visual-height": `${visibleH}px`,
        });

        const wasKeyboard = mobileKeyboardWasVisibleRef.current;
        shell.classList.toggle("wa-keyboard-visible", keyboardOpen);
        mobileKeyboardWasVisibleRef.current = keyboardOpen;
        syncComposerHeight();
        if (!keyboardOpen && wasKeyboard) {
          shouldStickToBottomRef.current = false;
        }
      } else {
        setViewportCssVars({
          "--wa-keyboard-inset": null,
          "--wa-visual-height": null,
        });
        shell.classList.remove("wa-keyboard-visible");
        mobileKeyboardWasVisibleRef.current = false;
      }

      syncComposerHeight();
    };

    const syncTimers = new Set();
    const scheduleTimer = (delay) => {
      const id = window.setTimeout(() => {
        syncTimers.delete(id);
        syncHeaderLayout();
      }, delay);
      syncTimers.add(id);
    };
    const scheduleSyncHeaderLayout = () => {
      syncHeaderLayout();
      window.requestAnimationFrame?.(syncHeaderLayout);
      scheduleTimer(80);
      scheduleTimer(220);
      scheduleTimer(420);
    };

    scheduleSyncHeaderLayout();

    const ro = new ResizeObserver(syncHeaderLayout);
    ro.observe(header);
    const composerStack = shell.querySelector(".wa-composerStack");
    const composerRo = composerStack ? new ResizeObserver(syncHeaderLayout) : null;
    composerRo?.observe(composerStack);

    const onMqChange = () => scheduleSyncHeaderLayout();
    if (mq.addEventListener) mq.addEventListener("change", onMqChange);
    else mq.addListener(onMqChange);

    const vv = window.visualViewport;
    const onVv = () => scheduleSyncHeaderLayout();
    if (vv) {
      vv.addEventListener("resize", onVv);
      vv.addEventListener("scroll", onVv);
    }

    const onInputFocusBlur = () => scheduleSyncHeaderLayout();
    document.addEventListener("focusin", onInputFocusBlur);
    document.addEventListener("focusout", onInputFocusBlur);

    return () => {
      ro.disconnect();
      composerRo?.disconnect();
      if (mq.removeEventListener) mq.removeEventListener("change", onMqChange);
      else mq.removeListener(onMqChange);
      if (vv) {
        vv.removeEventListener("resize", onVv);
        vv.removeEventListener("scroll", onVv);
      }
      document.removeEventListener("focusin", onInputFocusBlur);
      document.removeEventListener("focusout", onInputFocusBlur);
      syncTimers.forEach((id) => window.clearTimeout(id));
      syncTimers.clear();
      shell.classList.remove("wa-keyboard-visible");
      mobileKeyboardWasVisibleRef.current = false;
      document.documentElement.style.removeProperty("--wa-mobile-header-h");
      document.documentElement.style.removeProperty("--wa-vv-top");
      document.documentElement.style.removeProperty("--wa-keyboard-inset");
      document.documentElement.style.removeProperty("--wa-visual-height");
      document.documentElement.style.removeProperty("--wa-composer-stack-h");
      shell.style.removeProperty("--wa-mobile-header-h");
      shell.style.removeProperty("--wa-vv-top");
      shell.style.removeProperty("--wa-keyboard-inset");
      shell.style.removeProperty("--wa-visual-height");
      shell.style.removeProperty("--wa-composer-stack-h");
    };
  }, [conversaId]);

  const isSomeoneTyping = Boolean(
    typingInfo &&
    (myUserId == null || String(typingInfo.usuario_id ?? "") !== String(myUserId)) &&
    (typingInfo.expiresAt == null || typingInfo.expiresAt > Date.now())
  );

  const isGroup = useMemo(() => isGroupConversation(conversa), [conversa]);
  const podeAdicionarAtendente =
    ["admin", "supervisor", "atendente"].includes(userRole) &&
    !!conversaId &&
    !isGroup &&
    !isClosedAttendance(conversa);

  // Nunca exibir LID (lid:xxx) como nome ou número — identificador interno do WhatsApp
  const isLidValue = (v) => v != null && String(v).trim().toLowerCase().startsWith("lid:");

  const fromChat = useChatStore(
    (s) => (Array.isArray(s.chats) ? (s.chats.find((c) => String(c?.id) === String(conversaId)) ?? null) : null)
  );

  const showWhatsappInstanceUi = useWhatsappInstancesStore((s) => s.hasMultiple);

  const whatsappInstanceLabel = useMemo(() => {
    if (!showWhatsappInstanceUi || isGroup) return "";
    const source = conversa ?? fromChat ?? {};
    return String(
      source?.whatsapp_instance_nome ||
      source?.whatsappInstanceNome ||
      source?.whatsapp_instance_display_phone ||
      source?.whatsappInstanceDisplayPhone ||
      fromChat?.whatsapp_instance_nome ||
      fromChat?.whatsapp_instance_display_phone ||
      ""
    ).trim();
  }, [conversa, fromChat, isGroup, showWhatsappInstanceUi]);

  // Nome idêntico à lista de conversas: usa getDisplayName do chatList quando disponível
  const nome = useMemo(() => {
    const chatParaNome = fromChat ?? conversa;
    if (chatParaNome) {
      return getDisplayName(chatParaNome);
    }
    if (isGroup) {
      const g =
        conversa?.nome_grupo ||
        conversa?.contato_nome ||
        conversa?.nome ||
        "Grupo";
      return isLidValue(g) ? "Grupo" : g;
    }
    const raw =
      conversa?.contato_nome ||
      conversa?.nome_contato_cache ||
      conversa?.cliente?.nome ||
      conversa?.clientes?.nome ||
      conversa?.cliente_nome ||
      conversa?.nome ||
      "";
    const n = String(raw || "").trim();
    if (n && !isLidValue(n)) return n;
    const tel =
      conversa?.telefone_exibivel ||
      conversa?.cliente_telefone ||
      conversa?.telefone ||
      "";
    if (tel && !isLidValue(tel)) return String(tel).trim();
    return "Contato";
  }, [conversa, fromChat, conversaId, isGroup]);

  const replyBarPreview = useMemo(() => {
    if (!replyTo) return null;
    const chatParaNome = fromChat ?? conversa;
    const rt = safeString(replyTo?.tipo).toLowerCase();
    const thumb = rt === "imagem" || rt === "sticker" ? getMediaUrl(replyTo?.url, replyTo?.url_absoluta) : "";
    const meta = buildReplyMetaForPersist(replyTo, nome, chatParaNome);
    return {
      thumb: thumb || null,
      title: getReplySenderLabel(replyTo, nome, chatParaNome),
      text: replySnippetDisplay(meta) || snippetFromMsg(replyTo),
    };
  }, [replyTo, nome, fromChat, conversa]);

  const rawAvatarUrl = isGroup
    ? (conversa?.foto_grupo ?? fromChat?.foto_grupo ?? null)
    : (
        conversa?.foto_perfil ??
        conversa?.foto_perfil_contato_cache ??
        fromChat?.foto_perfil ??
        fromChat?.foto_perfil_contato_cache ??
        conversa?.cliente?.foto_perfil ??
        conversa?.clientes?.foto_perfil ??
        null
      );
  const avatarUrl = resolveConversaAvatarUrl(rawAvatarUrl);
  const avatar = useMemo(() => (isGroup ? "👥" : initials(nome)), [isGroup, nome]);
  const [avatarImgError, setAvatarImgError] = useState(false);
  const showAvatarImg = Boolean(avatarUrl && !avatarImgError);

  const badge = useMemo(() => {
    const status = getStatusAtendimentoEffective(conversa);
    const statusVisual =
      status === "em_atendimento" && conversa?.atendente_id != null && conversa?.aguardando_cliente_desde != null
        ? "aguardando_cliente"
        : status;
    return statusBadge(
      statusVisual,
      conversa?.exibir_badge_aberta,
      conversa?.finalizacao_motivo
    );
  }, [
    conversa?.status_atendimento,
    conversa?.status_atendimento_real,
    conversa?.atendente_id,
    conversa?.aguardando_cliente_desde,
    conversa?.exibir_badge_aberta,
    conversa?.finalizacao_motivo,
  ]);

  const showPagamentoConcluidoBadge = useMemo(
    () => exibirBadgePagamentoConcluido(conversa),
    [
      conversa?.pagamento_concluido_em,
      conversa?.status_atendimento,
      conversa?.status_atendimento_real,
    ]
  );

  /** Mobile: layout compacto em duas linhas + pill menor só em em_atendimento / aguardando_cliente */
  const headerCrmAtivoLayout = useMemo(() => {
    const s = safeString(getStatusAtendimentoEffective(conversa)).toLowerCase();
    return s === "em_atendimento" || s === "aguardando_cliente";
  }, [conversa?.status_atendimento, conversa?.status_atendimento_real, conversa]);

  const encerramentoAusenciaHint = useMemo(() => {
    const s = safeString(getStatusAtendimentoEffective(conversa)).toLowerCase();
    if (s !== "fechada") return null;
    if (safeString(conversa?.finalizacao_motivo).toLowerCase() !== "ausencia_cliente" && conversa?.finalizada_automaticamente !== true) {
      return null;
    }
    return "Encerrada automaticamente por ausência do cliente.";
  }, [
    conversa?.status_atendimento,
    conversa?.status_atendimento_real,
    conversa?.finalizacao_motivo,
    conversa?.finalizada_automaticamente,
  ]);

  useEffect(() => {
    setAvatarImgError(false);
  }, [avatarUrl]);

  const selectedTagIds = useMemo(
    () => (Array.isArray(tags) ? tags.map((t) => String(t?.id)) : []),
    [tags]
  );

  const lastMsg = useMemo(
    () => (mensagens?.length ? mensagens[mensagens.length - 1] : null),
    [mensagens]
  );
  const lastMsgKey = useMemo(() => {
    if (!lastMsg) return null;
    return String(
      lastMsg.tempId ??
      lastMsg.id ??
      lastMsg.whatsapp_id ??
      `${lastMsg.criado_em || ""}-${lastMsg.direcao || ""}-${(lastMsg.texto || lastMsg.conteudo || "").slice(0, 24)}`
    );
  }, [lastMsg]);

  const pinnedSet = useMemo(() => new Set((pinnedIds || []).map(String)), [pinnedIds]);
  const starredSet = useMemo(() => new Set((starredIds || []).map(String)), [starredIds]);
  const selectedSet = useMemo(() => new Set(Object.keys(selectedMsgIds || {}).filter((k) => selectedMsgIds[k])), [selectedMsgIds]);

  const pinnedTop = useMemo(() => {
    if (!mensagens?.length || !(pinnedIds || []).length) return null;
    const lastPinnedId = String((pinnedIds || [])[pinnedIds.length - 1]);
    return (mensagens || []).find((m) => String(m.id) === lastPinnedId) || null;
  }, [mensagens, pinnedIds]);

  useEffect(() => {
    // reset por conversa
    setReplyTo(null);
    setSelectMode(false);
    setSelectedMsgIds({});
    selectionOrderRef.current = [];
    setSelectionOrder([]);
    setForwardSelectIntent(false);

    if (!conversaId) {
      setPinnedIds([]);
      setStarredIds([]);
      return;
    }

    try {
      const pins = JSON.parse(localStorage.getItem(`zap:pins:${conversaId}`) || "[]");
      const stars = JSON.parse(localStorage.getItem(`zap:stars:${conversaId}`) || "[]");
      setPinnedIds(Array.isArray(pins) ? pins : []);
      setStarredIds(Array.isArray(stars) ? stars : []);
    } catch {
      setPinnedIds([]);
      setStarredIds([]);
    }
  }, [conversaId]);

  const tempoSemResponder = useMemo(() => {
    const list = Array.isArray(mensagens) ? mensagens : [];
    let ultimaIn = null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.direcao === "in") { ultimaIn = list[i]; break; }
    }
    if (!ultimaIn?.criado_em) return null;
    const diffMs = Date.now() - new Date(ultimaIn.criado_em).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);
    if (diffMin < 1) return "Agora";
    if (diffMin < 60) return `${diffMin} min`;
    if (diffH < 24) return `${diffH}h`;
    return `${diffD} dia(s)`;
  }, [mensagens]);

  /** Só reancora ao fundo se o utilizador ainda está colado ao fim (evita “puxar” ao meio ao ler histórico). */
  const snapIfStickBottom = useCallback(() => {
    const c = messagesContainerRef.current;
    if (!c || loadingMore || userScrollLockRef.current) return;
    if (!shouldStickToBottomRef.current) return;
    const list = useConversaStore.getState().mensagens || [];
    const last = list.length ? list[list.length - 1] : null;
    const guard = {
      canSnap: () => !userScrollLockRef.current && shouldStickToBottomRef.current,
      followUpFrame: false,
    };
    if (last && isPendingOutgoingTemp(last)) {
      snapThreadToBottom(c, virtualThreadRef, { min: true, ...guard });
      return;
    }
    snapThreadToBottom(c, virtualThreadRef, { followUpFrame: false, ...guard });
  }, [loadingMore]);

  const snapOptimisticSendToBottom = useCallback(() => {
    if (userScrollLockRef.current) return;
    const c = messagesContainerRef.current;
    if (!c) return;
    const guard = {
      canSnap: () => !userScrollLockRef.current,
      followUpFrame: !headerCompact,
    };
    snapThreadToBottom(c, virtualThreadRef, { min: true, ...guard });
    if (!headerCompact && typeof window !== "undefined") {
      window.requestAnimationFrame?.(() => {
        if (!userScrollLockRef.current) {
          snapThreadToBottom(c, virtualThreadRef, { min: true, followUpFrame: false, ...guard });
        }
      });
    }
  }, [headerCompact]);

  /** Evita animação zapAnimateIn na bolha otimista (parece “pulo” ao enviar). */
  const markOptimisticSeen = useCallback(
    (msg) => {
      if (!msg || conversaId == null) return;
      zapSeenMsgKeysRef.current.add(getMessageListReactKey(msg, conversaId));
    },
    [conversaId]
  );

  const appendOutgoingOptimisticMessage = useCallback(
    (optimisticMsg, opts = {}) => {
      if (!optimisticMsg) return;
      if (!userScrollLockRef.current) {
        shouldStickToBottomRef.current = true;
      }
      markOptimisticSeen(optimisticMsg);
      try {
        flushSync(() => anexarMensagemImediata(optimisticMsg));
      } catch {
        anexarMensagemImediata(optimisticMsg);
      }
      if (opts.bumpList !== false) {
        bumpChatListWithOptimisticMessage(conversaId, optimisticMsg, fromChat ?? conversa);
      }
      snapOptimisticSendToBottom();
    },
    [
      anexarMensagemImediata,
      conversa,
      conversaId,
      fromChat,
      markOptimisticSeen,
      snapOptimisticSendToBottom,
    ]
  );

  const scheduleArquivoSendConsistencyCheck = useCallback((targetConversaId, tempIds, opts = {}) => {
    if (!targetConversaId) return;
    const tempSet = new Set(
      (Array.isArray(tempIds) ? tempIds : [tempIds])
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    );
    const knownIdSet = new Set(
      (Array.isArray(opts.knownIds) ? opts.knownIds : [opts.knownIds])
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
    );
    if (!tempSet.size && !knownIdSet.size) return;

    const matchesTrackedUpload = (msg) => {
      if (!msg) return false;
      if (msg.tempId && tempSet.has(String(msg.tempId))) return true;
      if (msg.id != null && knownIdSet.has(String(msg.id))) return true;
      return false;
    };
    const hasPersistedIdentity = (msg) =>
      (msg?.id != null && String(msg.id).trim() !== "") ||
      (msg?.whatsapp_id != null && String(msg.whatsapp_id).trim() !== "");
    const isStillPending = (msg) => {
      const s = String(msg?.status_mensagem ?? msg?.status ?? "").toLowerCase();
      return s === "" || s === "pending" || s === "sending" || s === "enviando";
    };

    const run = (phase) => {
      const st = useConversaStore.getState();
      if (String(st.selectedId) !== String(targetConversaId)) return;
      const found = (st.mensagens || []).filter(matchesTrackedUpload);
      const hasEveryTemp =
        !tempSet.size ||
        [...tempSet].every((tid) => found.some((m) => String(m?.tempId || "") === tid)) ||
        (tempSet.size === 1 &&
          knownIdSet.size > 0 &&
          found.some((m) => m?.id != null && knownIdSet.has(String(m.id))));
      const hasAnyKnownId =
        !knownIdSet.size ||
        found.some((m) => m?.id != null && knownIdSet.has(String(m.id)));
      const allTrackedReconciled =
        (tempSet.size === 0 ||
          [...tempSet].every((tid) =>
            found.some((m) => String(m?.tempId || "") === tid && hasPersistedIdentity(m))
          )) &&
        (knownIdSet.size === 0 ||
          [...knownIdSet].every((kid) => found.some((m) => m?.id != null && knownIdSet.has(String(m.id)))));
      const needsPresenceRefresh =
        found.length === 0 ||
        !hasEveryTemp ||
        !hasAnyKnownId ||
        found.some((m) => !hasPersistedIdentity(m));
      const needsStatusRefresh =
        phase === "status" && found.some((m) => hasPersistedIdentity(m) && isStillPending(m));

      if (allTrackedReconciled && !needsStatusRefresh) return;
      if (needsPresenceRefresh || needsStatusRefresh) {
        void st.refresh({ silent: true });
      }
    };

    scheduleAfterInitialPaint(() => run("presence"), 700);
    scheduleAfterInitialPaint(() => run("status"), 2600);
  }, []);

  const applyOutgoingStatusOptimistic = useCallback(() => {
    if (!conversaId || isGroup) return null;

    const convStore = useConversaStore.getState();
    const chatStore = useChatStore.getState();
    const openConv =
      convStore.conversa && String(convStore.conversa.id) === String(conversaId)
        ? convStore.conversa
        : conversa;
    const row = (chatStore.chats || []).find((c) => String(c?.id) === String(conversaId));
    const source = openConv || row || fromChat;

    if (getStatusAtendimentoEffective(source) !== "em_atendimento") return null;

    // aguardando_cliente_desde NÃO entra aqui: o backend só marca quando
    // outboundQualificaParaAguardandoCliente() permite (ex.: não marca para
    // mensagem de ausência) — adivinhar isso no frontend pode setar um valor
    // que o backend nunca confirma, e também reseta um aguardando_cliente_desde
    // real pré-existente para "agora" sem necessidade.
    const patch = {
      id: conversaId,
      status_atendimento: "em_atendimento",
      status_atendimento_real: "em_atendimento",
      exibir_badge_aberta: false,
      tem_novas_mensagens_em_atendimento: false,
      ui_status_optimistic_at: Date.now(),
    };
    const revertOpen = openConv
      ? {
          id: conversaId,
          status_atendimento: openConv.status_atendimento,
          status_atendimento_real: openConv.status_atendimento_real,
          aguardando_cliente_desde: openConv.aguardando_cliente_desde,
          exibir_badge_aberta: openConv.exibir_badge_aberta,
          tem_novas_mensagens_em_atendimento: openConv.tem_novas_mensagens_em_atendimento,
          ui_status_optimistic_at: openConv.ui_status_optimistic_at ?? null,
        }
      : null;
    const revertRow = row
      ? {
          id: conversaId,
          status_atendimento: row.status_atendimento,
          status_atendimento_real: row.status_atendimento_real,
          aguardando_cliente_desde: row.aguardando_cliente_desde,
          exibir_badge_aberta: row.exibir_badge_aberta,
          tem_novas_mensagens_em_atendimento: row.tem_novas_mensagens_em_atendimento,
          ui_status_optimistic_at: row.ui_status_optimistic_at ?? null,
        }
      : null;

    convStore.patchConversa(patch);
    chatStore.updateChat(patch);

    return () => {
      if (revertOpen) useConversaStore.getState().patchConversa(revertOpen);
      if (revertRow) useChatStore.getState().updateChat(revertRow);
    };
  }, [conversa, conversaId, fromChat, isGroup]);

  useEffect(() => {
    const begin = () => {
      const el = messagesContainerRef.current;
      messagesScrollPreserveSnapRef.current = captureMessagesScrollAnchor(el);
      suppressAutoScrollRef.current = true;
      shouldStickToBottomRef.current = false;
    };
    const end = () => {
      const snap = messagesScrollPreserveSnapRef.current;
      const el = messagesContainerRef.current;
      if (snap && el) restoreMessagesScrollAnchor(el, snap);
    };
    const release = () => {
      messagesScrollPreserveSnapRef.current = null;
      suppressAutoScrollRef.current = false;
    };
    useConversaStore.getState().registerMessagesScrollPreserve({ begin, end, release });
    return () => useConversaStore.getState().registerMessagesScrollPreserve(null);
  }, []);

  useAutoScroll({
    conversaId: scrollThreadId,
    loading,
    lastMsgKey,
    lastMsg,
    myUserId,
    messagesContainerRef,
    shouldStickToBottomRef,
    virtualListRef: virtualThreadRef,
    mensagensCount: Array.isArray(mensagens) ? mensagens.length : 0,
    suppressAutoScrollRef,
    userScrollLockRef,
    cancelOpenSnapPendingRef,
  });

  useEffect(() => {
    const renderedCount = Array.isArray(mensagens) ? mensagens.length : 0;
    if (!conversaId || renderedCount <= 0) return undefined;
    const threadKey = String(conversaId);
    const run = () => {
      if (userScrollLockRef.current || userInterruptedOpenSnapRef.current) return;
      const st = useConversaStore.getState();
      const activeId = st.selectedId ?? st.conversa?.id ?? null;
      if (String(activeId ?? "") !== threadKey) return;
      const c = messagesContainerRef.current;
      if (!c) return;
      snapThreadToBottom(c, virtualThreadRef, {
        min: true,
        followUpFrame: false,
        canSnap: () => !userScrollLockRef.current && !userInterruptedOpenSnapRef.current,
      });
    };
    const t1 = window.setTimeout(run, 160);
    const t2 = window.setTimeout(run, 800);
    const t3 = window.setTimeout(run, 1500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [conversaId]);

  useLayoutEffect(() => {
    zapSeenMsgKeysRef.current = new Set();
    zapMsgsInitialPassRef.current = true;
  }, [conversaId]);

  useLayoutEffect(() => {
    if (loading || !conversaId) return;
    const list = Array.isArray(mensagens) ? mensagens : [];
    if (!zapMsgsInitialPassRef.current) return;
    if (list.length === 0) return;
    list.forEach((m) => {
      zapSeenMsgKeysRef.current.add(getMessageListReactKey(m, conversaId));
    });
    zapMsgsInitialPassRef.current = false;
  }, [loading, conversaId, mensagens]);

  const showToast = useCallback(
    (next) => {
      setToast(next);
      toastT.set(() => setToast(null), 3500);
    },
    [toastT]
  );

  const {
    mediaViewer,
    mediaPdfBlobUrl,
    mediaPdfLoading,
    mediaPdfError,
    mediaPrintLoading,
    mediaViewerImgRef,
    mediaViewerVideoRef,
    openMediaViewer,
    closeMediaViewer,
    handleMediaViewerPrint,
  } = useMediaViewer({ showToast });

  const {
    shareContactOpen,
    shareContactQuery,
    setShareContactQuery,
    shareContactList,
    shareContactLoading,
    shareContactSending,
    openShareContact,
    handleShareContactClose,
    handleShareContactSelect,
  } = useShareContact({ conversaId, showToast });

  const {
    shareLocationOpen,
    shareLocationGeoLoading,
    shareLocationGeoError,
    shareLocationLat,
    setShareLocationLat,
    shareLocationLng,
    setShareLocationLng,
    shareLocationNome,
    setShareLocationNome,
    shareLocationEndereco,
    setShareLocationEndereco,
    shareLocationSending,
    openShareLocation,
    handleEnviarLocalizacao,
    handleShareLocationClose,
  } = useShareLocation({ conversaId, showToast, composerRef });

  const handleComposerAppendApplied = useCallback(() => {
    showToast({
      type: "success",
      title: "Produto pronto",
      message: "O produto foi adicionado na caixa de mensagem.",
    });
  }, [showToast]);

  const clearPending = useCallback(() => {
    if (pendingPreview) {
      try {
        URL.revokeObjectURL(pendingPreview);
      } catch {}
    }
    pendingConversaIdRef.current = null;
    setPendingFile(null);
    setPendingPreview(null);
    setPendingCaption("");
  }, [pendingPreview]);

  const openMediaSendPreview = useCallback((file) => {
    if (!file || !conversaId) return;
    if (isArquivoBloqueadoWhatsApp(file)) {
      showToast({
        type: "error",
        title: "Arquivo não permitido",
        message: mensagemArquivoBloqueadoWhatsApp(file),
      });
      return;
    }
    pendingConversaIdRef.current = conversaId;
    setPendingFile(file);
    setPendingCaption("");
    if (isImageFile(file) || isVideoFile(file)) {
      requestAnimationFrame(() => {
        try {
          const url = fileToPreviewURL(file);
          setPendingPreview(url);
        } catch {
          setPendingPreview(null);
        }
      });
    } else {
      setPendingPreview(null);
    }
  }, [conversaId, showToast]);

  const onHeaderAvatarClick = useCallback(() => {
    if (showAvatarImg && avatarUrl) {
      openMediaViewer(avatarUrl, "imagem", nome);
    }
  }, [showAvatarImg, avatarUrl, nome, openMediaViewer]);

  const handleBackToList = useCallback(() => {
    setSelectedId(null);
  }, [setSelectedId]);

  const handleHeaderAvatarError = useCallback(() => {
    setAvatarImgError(true);
  }, []);

  const handleOpenProdutosPanel = useCallback(() => {
    setShowProdutosPanel(true);
  }, []);

  const handleOpenClienteSide = useCallback(() => {
    setShowClienteSide(true);
  }, []);

  const loadMoreScrollRef = useRef({ top: 0, height: 0 });
  const loadMoreAnchorRef = useRef(null);
  const loadMorePrevSeparatorCountRef = useRef(0);
  const scrollEndTimerRef = useRef(0);

  const captureLoadMoreAnchor = useCallback(() => {
    loadMorePrevSeparatorCountRef.current = mensagensComSeparadoresRef.current.length;
    const anchor = virtualThreadRef.current?.getScrollAnchor?.();
    if (anchor) {
      loadMoreAnchorRef.current = anchor;
      return;
    }
    const el = messagesContainerRef.current;
    if (el) {
      loadMoreScrollRef.current = { top: el.scrollTop, height: el.scrollHeight };
    }
  }, []);

  const tryLoadOlderMessages = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el || el.scrollTop >= 140) return;
    const st = useConversaStore.getState();
    if (!st.hasMore || st.loadingMore || !st.cursor || st.conversa?.mensagens_bloqueadas) return;
    captureLoadMoreAnchor();
    st.loadMore();
  }, [captureLoadMoreAnchor]);

  const releaseStickToBottom = useCallback(() => {
    shouldStickToBottomRef.current = false;
  }, []);

  const lockUserScroll = useCallback(() => {
    userScrollLockRef.current = true;
    window.clearTimeout(userScrollUnlockTimerRef.current);
  }, []);

  const scheduleUserScrollUnlock = useCallback((delayMs = 160) => {
    window.clearTimeout(userScrollUnlockTimerRef.current);
    userScrollUnlockTimerRef.current = window.setTimeout(() => {
      userScrollLockRef.current = false;
      const el = messagesContainerRef.current;
      if (el) {
        shouldStickToBottomRef.current = isNearBottom(el, 120);
      }
    }, delayMs);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const prevTop = messagesLastScrollTopRef.current;
    if (top < prevTop - 1) {
      shouldStickToBottomRef.current = false;
      cancelOpenSnapPendingRef.current?.();
      lockUserScroll();
      scheduleUserScrollUnlock(headerCompact ? 320 : 240);
    } else {
      if (isNearBottom(el, 120)) {
        shouldStickToBottomRef.current = true;
      }
    }
    messagesLastScrollTopRef.current = top;

    window.clearTimeout(scrollEndTimerRef.current);
    scrollEndTimerRef.current = window.setTimeout(
      tryLoadOlderMessages,
      headerCompact ? 200 : 140
    );
  }, [tryLoadOlderMessages, headerCompact, lockUserScroll, scheduleUserScrollUnlock]);

  useEffect(() => {
    messagesLastScrollTopRef.current = 0;
    userScrollLockRef.current = false;
    userInterruptedOpenSnapRef.current = false;
    window.clearTimeout(userScrollUnlockTimerRef.current);
  }, [scrollThreadId]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleMessagesScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleMessagesScroll);
      window.clearTimeout(scrollEndTimerRef.current);
    };
  }, [handleMessagesScroll, conversaId]);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    let touchStartY = 0;
    let touchActive = false;

    const onTouchStart = (e) => {
      touchActive = true;
      userInterruptedOpenSnapRef.current = true;
      touchStartY = e.touches?.[0]?.clientY ?? 0;
      lockUserScroll();
      releaseStickToBottom();
      cancelOpenSnapPendingRef.current?.();
    };
    const onTouchMove = (e) => {
      if (!touchActive) return;
      lockUserScroll();
      const y = e.touches?.[0]?.clientY ?? 0;
      if (Math.abs(touchStartY - y) > 4) releaseStickToBottom();
    };
    const onTouchEnd = () => {
      touchActive = false;
      const el = messagesContainerRef.current;
      if (el) {
        shouldStickToBottomRef.current = isNearBottom(el, 120);
      }
      scheduleUserScrollUnlock(headerCompact ? 200 : 160);
    };
    const onWheel = (e) => {
      if (e.deltaY < 0) {
        userInterruptedOpenSnapRef.current = true;
        lockUserScroll();
        releaseStickToBottom();
        cancelOpenSnapPendingRef.current?.();
        scheduleUserScrollUnlock(180);
      }
    };
    const onPointerDown = (e) => {
      if (e.pointerType && e.pointerType !== "touch") return;
      userInterruptedOpenSnapRef.current = true;
      lockUserScroll();
      releaseStickToBottom();
      cancelOpenSnapPendingRef.current?.();
    };
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(userScrollUnlockTimerRef.current);
    };
  }, [scrollThreadId, releaseStickToBottom, lockUserScroll, scheduleUserScrollUnlock]);

  useEffect(() => {
    if (loadingMore) return;
    const anchor = loadMoreAnchorRef.current;
    const fallback = loadMoreScrollRef.current;
    const hadCapture =
      anchor != null || (fallback.top !== 0 && fallback.height !== 0);
    if (!hadCapture) return;

    const prepended =
      mensagensComSeparadoresRef.current.length - loadMorePrevSeparatorCountRef.current;
    const el = messagesContainerRef.current;

    const restore = () => {
      lockUserScroll();
      if (anchor && prepended > 0 && virtualThreadRef.current?.restoreAfterPrepend) {
        virtualThreadRef.current.restoreAfterPrepend(anchor, prepended);
      } else if (el && fallback.height > 0) {
        const diff = el.scrollHeight - fallback.height;
        if (diff > 0) el.scrollTop = fallback.top + diff;
      }
      loadMoreAnchorRef.current = null;
      loadMoreScrollRef.current = { top: 0, height: 0 };
      scheduleUserScrollUnlock(headerCompact ? 280 : 220);
    };

    requestAnimationFrame(() => requestAnimationFrame(restore));
  }, [loadingMore]);

  /** Mesma estratégia do scroll ao topo: grava âncora antes do `loadMore` para restaurar posição após o lote. */
  const handleLoadOlderMessagesClick = useCallback(() => {
    const st = useConversaStore.getState();
    if (!st.hasMore || st.loadingMore || !st.cursor || st.conversa?.mensagens_bloqueadas) return;
    captureLoadMoreAnchor();
    st.loadMore();
  }, [captureLoadMoreAnchor]);

  const handleDropFile = useCallback(
    (file) => {
      if (!file) return;
      openMediaSendPreview(file);
    },
    [openMediaSendPreview]
  );

  const handleSendReaction = useCallback(
    async (msg, reaction) => {
      if (!conversaId || !msg?.id || !reaction) return;
      const mid = String(msg.id);
      if (reactionLoading[mid]) return;
      setReactionLoading((prev) => ({ ...prev, [mid]: true }));
      setLocalReactions((prev) => ({ ...prev, [mid]: reaction }));
      try {
        await enviarReacao(conversaId, msg.id, reaction);
      } catch (err) {
        console.error("Erro ao enviar reação:", err);
        setLocalReactions((prev) => {
          const next = { ...prev };
          delete next[mid];
          return next;
        });
        showToast({
          type: "error",
          title: "Falha ao reagir",
          message: err?.response?.data?.error || "Não foi possível registrar a reação.",
        });
      } finally {
        setReactionLoading((prev) => {
          const next = { ...prev };
          delete next[mid];
          return next;
        });
      }
    },
    [conversaId, reactionLoading, showToast]
  );

  const handleRemoveReaction = useCallback(
    async (msg) => {
      if (!conversaId || !msg?.id) return;
      const mid = String(msg.id);
      if (reactionLoading[mid]) return;
      if (!localReactions[mid]) return;
      setReactionLoading((prev) => ({ ...prev, [mid]: true }));
      const prevReaction = localReactions[mid];
      setLocalReactions((prev) => {
        const next = { ...prev };
        delete next[mid];
        return next;
      });
      try {
        await removerReacao(conversaId, msg.id);
      } catch (err) {
        console.error("Erro ao remover reação:", err);
        setLocalReactions((prev) => ({ ...prev, [mid]: prevReaction }));
        showToast({
          type: "error",
          title: "Falha ao remover reação",
          message: err?.response?.data?.error || "Não foi possível remover a reação.",
        });
      } finally {
        setReactionLoading((prev) => {
          const next = { ...prev };
          delete next[mid];
          return next;
        });
      }
    },
    [conversaId, localReactions, reactionLoading, showToast]
  );

  const onDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragOver = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragOver) setDragOver(true);
    },
    [dragOver]
  );

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const file = e.dataTransfer?.files?.[0];
      if (file) handleDropFile(file);
    },
    [handleDropFile]
  );

  const garantirConversaAbertaParaEnvio = useCallback(async () => {
    const atual = useConversaStore.getState().conversa;
    const alvo = atual && String(atual.id) === String(conversaId) ? atual : conversa;
    if (!isClosedAttendance(alvo)) return true;
    try {
      await reabrirConversa(conversaId);
      return true;
    } catch (e) {
      showToast({
        type: "error",
        title: "Erro ao reabrir",
        message: e?.response?.data?.error || e?.message || "Tente novamente.",
      });
      return false;
    }
  }, [conversaId, conversa, reabrirConversa, showToast]);

  const handleEnviarArquivo = useCallback(
    async (file, opts = {}) => {
      if (!file || !conversaId) return;
      if (isArquivoBloqueadoWhatsApp(file)) {
        showToast({
          type: "error",
          title: "Arquivo não permitido",
          message: mensagemArquivoBloqueadoWhatsApp(file),
        });
        clearPending();
        return;
      }
      if (!podeEnviar) {
        showToast({
          type: "warning",
          title: "Conversa não assumida",
          message: "Clique em Assumir para enviar mensagens.",
        });
        clearPending();
        return;
      }
      const conversaAberta = await garantirConversaAbertaParaEnvio();
      if (!conversaAberta) {
        clearPending();
        return;
      }

      const flightKey = `${conversaId}:${file?.name || "arquivo"}:${file?.size ?? 0}:${file?.lastModified ?? 0}`;
      if (arquivoEnvioInFlightRef.current.has(flightKey)) return;
      arquivoEnvioInFlightRef.current.add(flightKey);

      const legenda = String(opts.caption ?? "").trim();
      const optimisticMsg = buildOptimisticOutgoingMessage({
        conversaId,
        file,
        caption: legenda,
        forceStickerType: opts.forceStickerType,
      });
      const tempId = optimisticMsg.tempId;
      debugMessageBoundary("send_media", {
        conversa_id: conversaId,
        atendimento_id: conversa?.atendimento_id ?? conversa?.atendimento?.id,
        cliente_id: conversa?.cliente_id ?? conversa?.cliente?.id,
        phone: conversa?.phone ?? conversa?.telefone ?? conversa?.cliente_telefone,
        message_id: tempId,
      });
      const revertOutgoingStatus = applyOutgoingStatusOptimistic();
      appendOutgoingOptimisticMessage(optimisticMsg);
      clearPending();

      const formData = new FormData();
      const nomeArquivo = isAudioFile(file) ? getAudioFilename(file) : (file?.name || "arquivo");
      formData.append("file", file, nomeArquivo);
      if (opts.forceStickerType) {
        formData.append("tipo", "sticker");
      }
      if (legenda) {
        formData.append("caption", legenda);
      }
      formData.append("client_temp_id", tempId);
      formData.append("conversa_id", String(conversaId));
      if (conversa?.atendimento_id != null) formData.append("atendimento_id", String(conversa.atendimento_id));
      if (conversa?.cliente_id != null) formData.append("cliente_id", String(conversa.cliente_id));
      if (conversa?.telefone != null) formData.append("phone", String(conversa.telefone));

      setSendingTracked(true);
      try {
        const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData);

        const reconciliations = extractArquivoApiReconciliations(data, conversaId, [tempId]);
        if (reconciliations.length) {
          reconciliations.forEach(({ tempId: tid, realMsg }) => reconciliarMensagem(tid, realMsg));
        } else {
          const realMsg = normalizeArquivoApiToMessage(data, conversaId);
          if (realMsg?.id != null || realMsg?.whatsapp_id) {
            reconciliarMensagem(tempId, realMsg);
          }
        }
        if (
          !opts.waitSocketOnly &&
          reconciliations.length === 0 &&
          (!data?.id || Number(data?.conversa_id) !== Number(conversaId))
        ) {
          const targetId = conversaId;
          scheduleAfterInitialPaint(() => {
            const st = useConversaStore.getState();
            if (String(st.selectedId) !== String(targetId)) return;
            void st.refresh({ silent: true });
          }, 400);
        }
        const knownIds = [
          data?.id,
          ...(Array.isArray(data?.ids) ? data.ids : []),
          ...(Array.isArray(data?.results) ? data.results.map((r) => r?.id) : []),
        ];
        scheduleArquivoSendConsistencyCheck(conversaId, [tempId], { knownIds });
      } catch (err) {
        revertOutgoingStatus?.();
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        marcarMensagemTempErro(tempId, {
          erro_mensagem: apiMsg || err?.message,
        });
        showToast({
          type: "error",
          title: is403 ? "Acesso restrito" : "Falha ao enviar",
          message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar o arquivo. Tente novamente."),
        });
      } finally {
        arquivoEnvioInFlightRef.current.delete(flightKey);
        setSendingTracked(false);
        focusMessageInput();
      }
    },
    [
      conversaId,
      conversa,
      debugMessageBoundary,
      showToast,
      clearPending,
      podeEnviar,
      garantirConversaAbertaParaEnvio,
      focusMessageInput,
      reconciliarMensagem,
      marcarMensagemTempErro,
      appendOutgoingOptimisticMessage,
      applyOutgoingStatusOptimistic,
      scheduleArquivoSendConsistencyCheck,
      setSendingTracked,
    ]
  );

  const handleFileInputChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        e.target.value = "";
        return;
      }
      handleDropFile(file);
      e.target.value = "";
    },
    [handleDropFile]
  );

  const handleCameraInputChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        e.target.value = "";
        return;
      }
      handleDropFile(file);
      e.target.value = "";
    },
    [handleDropFile]
  );

  const handleFototecaInputChange = useCallback(
    async (e) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      if (!files.length || !conversaId) return;
      if (!podeEnviar) {
        showToast({
          type: "warning",
          title: "Conversa não assumida",
          message: "Clique em Assumir para enviar mensagens.",
        });
        return;
      }
      const conversaAberta = await garantirConversaAbertaParaEnvio();
      if (!conversaAberta) return;
      const tempIds = [];
      shouldStickToBottomRef.current = true;
      const revertOutgoingStatus = applyOutgoingStatusOptimistic();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const optimisticMsg = buildOptimisticOutgoingMessage({ conversaId, file: f });
        tempIds.push(optimisticMsg.tempId);
        debugMessageBoundary("send_media", {
          conversa_id: conversaId,
          atendimento_id: conversa?.atendimento_id ?? conversa?.atendimento?.id,
          cliente_id: conversa?.cliente_id ?? conversa?.cliente?.id,
          phone: conversa?.phone ?? conversa?.telefone ?? conversa?.cliente_telefone,
          message_id: optimisticMsg.tempId,
        });
        appendOutgoingOptimisticMessage(optimisticMsg, { bumpList: i === files.length - 1 });
      }

      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("file", files[i]);
      }
      formData.append("client_temp_ids", JSON.stringify(tempIds));
      formData.append("conversa_id", String(conversaId));
      if (conversa?.atendimento_id != null) formData.append("atendimento_id", String(conversa.atendimento_id));
      if (conversa?.cliente_id != null) formData.append("cliente_id", String(conversa.cliente_id));
      if (conversa?.telefone != null) formData.append("phone", String(conversa.telefone));
      setSendingTracked(true);
      try {
        const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData);
        const reconciliations = extractArquivoApiReconciliations(data, conversaId, tempIds);
        reconciliations.forEach(({ tempId, realMsg }) => reconciliarMensagem(tempId, realMsg));

        const failures = extractArquivoApiFailures(data, tempIds);
        failures.forEach(({ tempId, error }) =>
          marcarMensagemTempErro(tempId, { erro_mensagem: error })
        );

        const reconciledTempIds = new Set(reconciliations.map((r) => String(r.tempId)));
        const failedTempIds = new Set(failures.map((f) => String(f.tempId)));
        const pendingTempIds = tempIds.filter(
          (tid) => !reconciledTempIds.has(String(tid)) && !failedTempIds.has(String(tid))
        );

        if (pendingTempIds.length > 0) {
          const targetId = conversaId;
          scheduleAfterInitialPaint(() => {
            const st = useConversaStore.getState();
            if (String(st.selectedId) !== String(targetId)) return;
            void st.refresh({ silent: true });
          }, 400);
        }
        const knownIds = [
          data?.id,
          ...(Array.isArray(data?.ids) ? data.ids : []),
          ...(Array.isArray(data?.results) ? data.results.map((r) => r?.id) : []),
        ];
        const tempIdsToCheck = tempIds.filter((tid) => !failedTempIds.has(String(tid)));
        if (tempIdsToCheck.length > 0) {
          scheduleArquivoSendConsistencyCheck(conversaId, tempIdsToCheck, { knownIds });
        }

        if (failures.length > 0) {
          const okCount = reconciliations.length;
          showToast({
            type: okCount > 0 ? "warning" : "error",
            title: okCount > 0 ? "Envio parcial" : "Falha ao enviar",
            message:
              okCount > 0
                ? `${okCount} foto(s) enviada(s). ${failures.length} falhou(aram).`
                : failures[0]?.error || "Não foi possível enviar as fotos. Tente novamente.",
          });
        }
      } catch (err) {
        revertOutgoingStatus?.();
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        const partialFailures = extractArquivoApiFailures(err?.response?.data, tempIds);
        if (partialFailures.length) {
          const reconciliations = extractArquivoApiReconciliations(err?.response?.data, conversaId, tempIds);
          reconciliations.forEach(({ tempId, realMsg }) => reconciliarMensagem(tempId, realMsg));
          partialFailures.forEach(({ tempId, error }) =>
            marcarMensagemTempErro(tempId, { erro_mensagem: error })
          );
          showToast({
            type: reconciliations.length > 0 ? "warning" : "error",
            title: reconciliations.length > 0 ? "Envio parcial" : is403 ? "Acesso restrito" : "Falha ao enviar",
            message:
              reconciliations.length > 0
                ? `${reconciliations.length} foto(s) enviada(s). ${partialFailures.length} falhou(aram).`
                : apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar as fotos. Tente novamente."),
          });
        } else {
          tempIds.forEach((tid) => marcarMensagemTempErro(tid, { erro_mensagem: apiMsg || err?.message }));
          showToast({
            type: "error",
            title: is403 ? "Acesso restrito" : "Falha ao enviar",
            message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar as fotos. Tente novamente."),
          });
        }
      } finally {
        setSendingTracked(false);
        focusMessageInput();
      }
    },
    [
      conversaId,
      conversa,
      debugMessageBoundary,
      podeEnviar,
      showToast,
      garantirConversaAbertaParaEnvio,
      focusMessageInput,
      marcarMensagemTempErro,
      reconciliarMensagem,
      appendOutgoingOptimisticMessage,
      applyOutgoingStatusOptimistic,
      scheduleArquivoSendConsistencyCheck,
      setSendingTracked,
    ]
  );

  const handleDocumentInputChange = useCallback(
    async (e) => {
      let files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = "";
      if (!files.length || !conversaId) return;

      const blocked = files.filter((f) => isArquivoBloqueadoWhatsApp(f));
      if (blocked.length) {
        showToast({
          type: "error",
          title: "Arquivo não permitido",
          message: mensagemArquivoBloqueadoWhatsApp(blocked[0]),
        });
        files = files.filter((f) => !isArquivoBloqueadoWhatsApp(f));
        if (!files.length) return;
      }

      if (files.length > MAX_DOCUMENTOS_LOTE_ENVIO) {
        showToast({
          type: "warning",
          title: "Limite de documentos",
          message: `Selecione no máximo ${MAX_DOCUMENTOS_LOTE_ENVIO} documentos por vez. Apenas os primeiros ${MAX_DOCUMENTOS_LOTE_ENVIO} serão enviados.`,
        });
        files = files.slice(0, MAX_DOCUMENTOS_LOTE_ENVIO);
      }

      if (files.length === 1) {
        handleDropFile(files[0]);
        return;
      }

      if (!podeEnviar) {
        showToast({
          type: "warning",
          title: "Conversa não assumida",
          message: "Clique em Assumir para enviar mensagens.",
        });
        return;
      }

      const conversaAberta = await garantirConversaAbertaParaEnvio();
      if (!conversaAberta) return;
      const tempIds = [];
      shouldStickToBottomRef.current = true;
      const revertOutgoingStatus = applyOutgoingStatusOptimistic();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const optimisticMsg = buildOptimisticOutgoingMessage({ conversaId, file: f });
        tempIds.push(optimisticMsg.tempId);
        debugMessageBoundary("send_media", {
          conversa_id: conversaId,
          atendimento_id: conversa?.atendimento_id ?? conversa?.atendimento?.id,
          cliente_id: conversa?.cliente_id ?? conversa?.cliente?.id,
          phone: conversa?.phone ?? conversa?.telefone ?? conversa?.cliente_telefone,
          message_id: optimisticMsg.tempId,
        });
        appendOutgoingOptimisticMessage(optimisticMsg, { bumpList: i === files.length - 1 });
      }

      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("file", files[i]);
      }
      formData.append("client_temp_ids", JSON.stringify(tempIds));
      formData.append("conversa_id", String(conversaId));
      if (conversa?.atendimento_id != null) formData.append("atendimento_id", String(conversa.atendimento_id));
      if (conversa?.cliente_id != null) formData.append("cliente_id", String(conversa.cliente_id));
      if (conversa?.telefone != null) formData.append("phone", String(conversa.telefone));
      setSendingTracked(true);
      try {
        const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData);
        const reconciliations = extractArquivoApiReconciliations(data, conversaId, tempIds);
        reconciliations.forEach(({ tempId, realMsg }) => reconciliarMensagem(tempId, realMsg));

        const failures = extractArquivoApiFailures(data, tempIds);
        failures.forEach(({ tempId, error }) =>
          marcarMensagemTempErro(tempId, { erro_mensagem: error })
        );

        const reconciledTempIds = new Set(reconciliations.map((r) => String(r.tempId)));
        const failedTempIds = new Set(failures.map((f) => String(f.tempId)));
        const pendingTempIds = tempIds.filter(
          (tid) => !reconciledTempIds.has(String(tid)) && !failedTempIds.has(String(tid))
        );

        if (pendingTempIds.length > 0) {
          const targetId = conversaId;
          scheduleAfterInitialPaint(() => {
            const st = useConversaStore.getState();
            if (String(st.selectedId) !== String(targetId)) return;
            void st.refresh({ silent: true });
          }, 400);
        }
        const knownIds = [
          data?.id,
          ...(Array.isArray(data?.ids) ? data.ids : []),
          ...(Array.isArray(data?.results) ? data.results.map((r) => r?.id) : []),
        ];
        const tempIdsToCheck = tempIds.filter((tid) => !failedTempIds.has(String(tid)));
        if (tempIdsToCheck.length > 0) {
          scheduleArquivoSendConsistencyCheck(conversaId, tempIdsToCheck, { knownIds });
        }

        if (failures.length > 0) {
          const okCount = reconciliations.length;
          showToast({
            type: okCount > 0 ? "warning" : "error",
            title: okCount > 0 ? "Envio parcial" : "Falha ao enviar",
            message:
              okCount > 0
                ? `${okCount} documento(s) enviado(s). ${failures.length} falhou(aram).`
                : failures[0]?.error || "Não foi possível enviar os documentos. Tente novamente.",
          });
        }
      } catch (err) {
        revertOutgoingStatus?.();
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        const partialFailures = extractArquivoApiFailures(err?.response?.data, tempIds);
        if (partialFailures.length) {
          const reconciliations = extractArquivoApiReconciliations(err?.response?.data, conversaId, tempIds);
          reconciliations.forEach(({ tempId, realMsg }) => reconciliarMensagem(tempId, realMsg));
          partialFailures.forEach(({ tempId, error }) =>
            marcarMensagemTempErro(tempId, { erro_mensagem: error })
          );
          showToast({
            type: reconciliations.length > 0 ? "warning" : "error",
            title: reconciliations.length > 0 ? "Envio parcial" : is403 ? "Acesso restrito" : "Falha ao enviar",
            message:
              reconciliations.length > 0
                ? `${reconciliations.length} documento(s) enviado(s). ${partialFailures.length} falhou(aram).`
                : apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar os documentos. Tente novamente."),
          });
        } else {
          tempIds.forEach((tid) => marcarMensagemTempErro(tid, { erro_mensagem: apiMsg || err?.message }));
          showToast({
            type: "error",
            title: is403 ? "Acesso restrito" : "Falha ao enviar",
            message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar os documentos. Tente novamente."),
          });
        }
      } finally {
        setSendingTracked(false);
        focusMessageInput();
      }
    },
    [
      conversaId,
      conversa,
      debugMessageBoundary,
      podeEnviar,
      showToast,
      handleDropFile,
      garantirConversaAbertaParaEnvio,
      focusMessageInput,
      marcarMensagemTempErro,
      reconciliarMensagem,
      appendOutgoingOptimisticMessage,
      applyOutgoingStatusOptimistic,
      scheduleArquivoSendConsistencyCheck,
      setSendingTracked,
    ]
  );

  const handleConfirmSendFile = useCallback(async () => {
    if (!pendingFile || confirmSendLockRef.current) return;
    if (pendingConversaIdRef.current && String(pendingConversaIdRef.current) !== String(conversaId)) {
      clearPending();
      return;
    }
    confirmSendLockRef.current = true;
    try {
      const captionToSend = pendingCaption;
      await handleEnviarArquivo(pendingFile, { caption: captionToSend });
    } finally {
      confirmSendLockRef.current = false;
    }
  }, [pendingFile, pendingCaption, conversaId, clearPending, handleEnviarArquivo]);

  const handleConfirmSendImageMobile = useCallback(
    async ({ sendAsOriginal, croppedAreaPixels, rotation, fileName, mimeType }) => {
      if (!pendingFile || !pendingPreview || confirmSendLockRef.current) return;
      if (pendingConversaIdRef.current && String(pendingConversaIdRef.current) !== String(conversaId)) {
        clearPending();
        return;
      }
      confirmSendLockRef.current = true;
      try {
        const captionToSend = pendingCaption;
        let fileToSend = pendingFile;
        if (!sendAsOriginal && croppedAreaPixels) {
          const { exportCroppedImageFile } = await import("./utils/imageCropExport.js");
          fileToSend = await exportCroppedImageFile({
            imageSrc: pendingPreview,
            pixelCrop: croppedAreaPixels,
            rotation: rotation || 0,
            fileName: fileName || pendingFile.name,
            mimeType: mimeType || pendingFile.type,
          });
        }
        await handleEnviarArquivo(fileToSend, { caption: captionToSend });
      } finally {
        confirmSendLockRef.current = false;
      }
    },
    [pendingFile, pendingPreview, pendingCaption, conversaId, clearPending, handleEnviarArquivo]
  );

  const persistRecentSticker = useCallback(
    async (file) => {
      try {
        const dataUrl = await toDataUrl(file);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const item = {
          id,
          name: file.name || "figurinha",
          mimeType: file.type || "image/webp",
          dataUrl,
          ts: Date.now(),
        };
        const current = readRecentStickers(user);
        const next = [item, ...current.filter((x) => x?.dataUrl !== dataUrl)].slice(0, STICKER_RECENTS_LIMIT);
        writeRecentStickers(user, next);
      } catch {
        /* ignore */
      }
    },
    [user]
  );

  const sendStickerFile = useCallback(
    async (inputFile) => {
      if (!inputFile || !conversaId) return;
      try {
        let fileToSend = inputFile;
        const type = String(inputFile.type || "").toLowerCase();
        const shouldConvert = type.startsWith("image/") && type !== "image/webp" && !type.includes("gif");
        if (shouldConvert) {
          try {
            fileToSend = await convertImageToWebp(inputFile);
          } catch {
            fileToSend = inputFile;
          }
        }
        await handleEnviarArquivo(fileToSend, { forceStickerType: true, waitSocketOnly: true });
        await persistRecentSticker(fileToSend);
        composerRef.current?.closePanels?.();
      } catch {
        /* toast já tratado no envio */
      }
    },
    [conversaId, handleEnviarArquivo, persistRecentSticker]
  );

  const handleStickerInputChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      await sendStickerFile(file);
    },
    [sendStickerFile]
  );

  const toggleTimeline = useCallback(() => {
    setShowTimeline((v) => !v);
  }, []);

  const handleCloseTimeline = useCallback(() => setShowTimeline(false), []);

  const enviarTextoEmAndamentoRef = useRef(false);
  const enviarTextoQueueRef = useRef(Promise.resolve());

  const handleEnviar = useCallback(async (forcedText) => {
    if (!conversaId) return;
    if (!podeEnviar) {
      showToast({
        type: "warning",
        title: "Conversa não assumida",
        message: "Clique em Assumir para enviar mensagens.",
      });
      return;
    }

    const forcedLooksLikeEvent =
      forcedText &&
      typeof forcedText === "object" &&
      ("nativeEvent" in forcedText || "preventDefault" in forcedText || "currentTarget" in forcedText);
    const t = safeString(forcedLooksLikeEvent ? undefined : forcedText).trim();
    if (!t) return;
    const conversaAberta = await garantirConversaAbertaParaEnvio();
    if (!conversaAberta) return;
    const socket = getSocket();
    if (socket?.connected) socket.emit("typing_stop", { conversa_id: conversaId });
    const chatParaNome = fromChat ?? conversa;
    const replyMeta = buildReplyMetaForPersist(replyTo, nome, chatParaNome);

    const optimisticMsg = buildOptimisticOutgoingMessage({
      conversaId,
      texto: t,
      replyMeta: replyMeta || undefined,
    });
    const tempId = optimisticMsg.tempId;
    const revertOutgoingStatus = applyOutgoingStatusOptimistic();
    appendOutgoingOptimisticMessage(optimisticMsg);
    setReplyTo(null);

    const runSend = async () => {
      let envioFalhou = false;
      enviarTextoEmAndamentoRef.current = true;
      setSendingTracked(true);
      try {
        const res = await enviarMensagem(conversaId, t, replyMeta || undefined, tempId);
        const resMsgId = res?.mensagem?.id ?? res?.id;
        const realMsg = normalizeTextSendApiToMessage(res, conversaId);
        if (realMsg) {
          reconciliarMensagem(tempId, realMsg);
        }
        if (res?.mensagem?.id && replyMeta) {
          saveReplyMeta(conversaId, res.mensagem.id, replyMeta);
        }
        if (res?.ok === false && (resMsgId == null || resMsgId === "")) {
          marcarMensagemTempErro(tempId);
        }
      } catch (err) {
        envioFalhou = true;
        revertOutgoingStatus?.();
        console.error("Erro ao enviar mensagem:", err);
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        marcarMensagemTempErro(tempId, { erro_mensagem: apiMsg || err?.message });
        // Restaura o texto no composer SOMENTE se estiver vazio — se o atendente já
        // continuou digitando um novo rascunho, não sobrescrever/misturar com o texto
        // que falhou (ele fica preservado na bolha de erro, com botão de retry).
        const draftAtual = String(composerRef.current?.getText?.() ?? "").trim();
        if (!draftAtual) {
          composerRef.current?.setText?.(t);
        }
        if (replyTo) setReplyTo(replyTo);
        showToast({
          type: "error",
          title: is403 ? "Acesso restrito" : "Falha ao enviar",
          message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar a mensagem. Verifique sua conexão."),
        });
        focusMessageInput();
      } finally {
        enviarTextoEmAndamentoRef.current = false;
        setSendingTracked(false);
      }
      if (!envioFalhou) {
        focusMessageInput();
      }
    };

    enviarTextoQueueRef.current = enviarTextoQueueRef.current
      .catch(() => {})
      .then(runSend);
    await enviarTextoQueueRef.current;
  }, [
    conversaId,
    replyTo,
    showToast,
    appendOutgoingOptimisticMessage,
    applyOutgoingStatusOptimistic,
    reconciliarMensagem,
    marcarMensagemTempErro,
    nome,
    conversa,
    fromChat,
    podeEnviar,
    garantirConversaAbertaParaEnvio,
    focusMessageInput,
    setSendingTracked,
  ]);

  const {
    pixModalOpen,
    setPixModalOpen,
    pixConfigLoading,
    pixConfigSaving,
    pixActionBusy,
    pixTipoChave,
    setPixTipoChave,
    pixChave,
    setPixChave,
    pixNomeRecebedor,
    setPixNomeRecebedor,
    pixMensagemPadrao,
    setPixMensagemPadrao,
    fetchPixConfigIfNeeded,
    handleSalvarPixConfig,
    handlePixMenuClick,
  } = usePixConfig({
    conversaId,
    sending,
    podeEnviar,
    showToast,
    handleEnviar,
    composerRef,
  });

  const persistPins = useCallback((next) => {
    if (!conversaId) return;
    try {
      localStorage.setItem(`zap:pins:${conversaId}`, JSON.stringify(next || []));
    } catch {}
  }, [conversaId]);

  const persistStars = useCallback((next) => {
    if (!conversaId) return;
    try {
      localStorage.setItem(`zap:stars:${conversaId}`, JSON.stringify(next || []));
    } catch {}
  }, [conversaId]);

  const togglePin = useCallback((msg) => {
    if (!msg?.id || !conversaId) return;
    setPinnedIds((cur) => {
      const id = String(msg.id);
      const has = (cur || []).map(String).includes(id);
      const next = has ? (cur || []).filter((x) => String(x) !== id) : [...(cur || []), id];
      persistPins(next);
      showToast({ type: "info", title: has ? "Desafixada" : "Fixada", message: snippetFromMsg(msg) });
      return next;
    });
  }, [conversaId, persistPins, showToast]);

  const toggleStar = useCallback((msg) => {
    if (!msg?.id || !conversaId) return;
    setStarredIds((cur) => {
      const id = String(msg.id);
      const has = (cur || []).map(String).includes(id);
      const next = has ? (cur || []).filter((x) => String(x) !== id) : [...(cur || []), id];
      persistStars(next);
      showToast({ type: "info", title: has ? "Removida dos favoritos" : "Favoritada", message: snippetFromMsg(msg) });
      return next;
    });
  }, [conversaId, persistStars, showToast]);

  const startSelect = useCallback((msg) => {
    if (!msg?.id || msg.apagada_para_todos) return;
    setForwardSelectIntent(false);
    setSelectMode(true);
    const key = String(msg.id);
    setSelectedMsgIds((cur) => {
      const next = { ...(cur || {}), [key]: true };
      let ord = selectionOrderRef.current;
      ord = ord.includes(key) ? ord : [...ord, key];
      selectionOrderRef.current = ord;
      setSelectionOrder(ord);
      return next;
    });
  }, []);

  const toggleSelected = useCallback(
    (msg) => {
      if (!msg?.id || msg.apagada_para_todos) return;
      setSelectedMsgIds((cur) => {
        const key = String(msg.id);
        const wasOn = !!cur[key];
        const nextOn = !wasOn;
        let ord = selectionOrderRef.current;
        if (nextOn && forwardSelectIntent && ord.length >= FORWARD_SELECT_MAX && !ord.includes(key)) {
          showToast({
            type: "warning",
            title: "Limite",
            message: `No máximo ${FORWARD_SELECT_MAX} mensagens por encaminhamento.`,
          });
          return cur;
        }
        ord = nextOn ? (ord.includes(key) ? ord : [...ord, key]) : ord.filter((k) => k !== key);
        selectionOrderRef.current = ord;
        setSelectionOrder(ord);
        return { ...cur, [key]: nextOn };
      });
    },
    [forwardSelectIntent, showToast]
  );

  const exitSelectMode = useCallback(() => {
    selectionOrderRef.current = [];
    setSelectionOrder([]);
    setSelectedMsgIds({});
    setSelectMode(false);
    setForwardSelectIntent(false);
  }, []);

  const {
    forwardOpen,
    forwardMsgs,
    forwardQuery,
    setForwardQuery,
    forwardSending,
    forwardCandidates,
    forwardClientes,
    forwardClientesLoading,
    forwardColaboradoresFiltered,
    forwardColaboradoresLoading,
    forwardSelectedConversaIds,
    forwardMax10Msg,
    forwardMultiProgress,
    forwardPreviewLabel,
    closeForward,
    openForwardFromSelection,
    toggleForwardConversaSelect,
    confirmForwardToCliente,
    confirmForwardTo,
    confirmForwardToColaborador,
    confirmForwardToMany,
  } = useForwardFlow({
    conversa,
    conversaId,
    user,
    showToast,
    exitSelectMode,
  });

  const handleReplyAction = useCallback((msg) => {
    setReplyTo(msg || null);
    focusMessageInput();
  }, [focusMessageInput]);

  const handleInfoAction = useCallback((msg) => {
    if (!msg) return;
    setMsgInfo(msg);
    setMsgInfoOpen(true);
  }, []);

  const handleCopyResult = useCallback((ok) => {
    showToast({
      type: ok ? "success" : "error",
      title: ok ? "Copiado" : "Falha ao copiar",
      message: ok ? "Mensagem copiada para a área de transferência." : "Não foi possível copiar. Tente novamente.",
    });
  }, [showToast]);

  const handleForwardAction = useCallback((msg) => {
    if (!msg?.id || msg.apagada_para_todos) {
      if (msg?.apagada_para_todos) {
        showToast({
          type: "info",
          title: "Não disponível",
          message: "Não é possível encaminhar uma mensagem apagada.",
        });
      }
      return;
    }
    setForwardSelectIntent(true);
    setSelectMode(true);
    const key = String(msg.id);
    const ord = [key];
    selectionOrderRef.current = ord;
    setSelectionOrder(ord);
    setSelectedMsgIds({ [key]: true });
  }, [showToast]);

  const orderedSelectedIds = useMemo(
    () => (selectionOrder || []).filter((id) => selectedMsgIds?.[id]),
    [selectionOrder, selectedMsgIds]
  );

  const handleForwardAdvance = useCallback(() => {
    openForwardFromSelection(orderedSelectedIds, mensagens);
  }, [openForwardFromSelection, orderedSelectedIds, mensagens]);

  const handleDeleteForMe = useCallback(
    async (msg) => {
      if (!conversaId || !msg?.id) return;
      const preview = snippetFromMsg(msg).slice(0, 120);
      const isMedia = isRichMediaMessage(msg);
      const ok = window.confirm(
        isMedia
          ? `Ocultar esta mídia só para você?\n\n` +
              `• Ela continua no histórico para os outros atendentes.\n` +
              `• Não apaga o arquivo no servidor nem no WhatsApp.\n\n` +
              `Prévia: "${preview || "(mídia)"}"`
          : `Ocultar esta mensagem só para você?\n\n` +
              `Os outros da conversa continuam vendo.\n\n` +
              `Prévia: "${preview || "(sem texto)"}"`
      );
      if (!ok) return;
      try {
        await excluirMensagem(conversaId, msg.id, { scope: "me" });
        removerMensagem(msg.id);
        showToast({ type: "success", title: "Apagada para mim", message: "A mensagem foi removida da sua visualização." });
      } catch (e) {
        console.error("Erro ao apagar pra mim:", e);
        showToast({ type: "error", title: "Falha ao apagar", message: e.response?.data?.error || "Não foi possível apagar a mensagem." });
      }
    },
    [conversaId, showToast, removerMensagem]
  );

  const handleDeleteForEveryone = useCallback(
    async (msg) => {
      if (!conversaId || msg?.apagada_para_todos) return;
      const mid = msg?.id;
      if (mid == null || String(mid).trim() === "") {
        showToast({
          type: "warning",
          title: "Aguarde confirmação",
          message: "Só é possível apagar para todos depois que a mensagem for confirmada pelo servidor.",
        });
        return;
      }
      if (!msg?.whatsapp_id) {
        showToast({
          type: "warning",
          title: "Aguarde confirmacao",
          message: "So e possivel apagar para todos depois que o WhatsApp confirmar a mensagem.",
        });
        return;
      }
      // regra: "para todos" somente para mensagens enviadas por mim
      const souAutor =
        (msg?.autor_usuario_id != null && String(msg.autor_usuario_id) === String(myUserId)) ||
        (msg?.autor_usuario_id == null && isOutgoingMessage(msg));
      if (!myUserId || !souAutor) {
        showToast({
          type: "info",
          title: "Somente suas mensagens",
          message: "Você só pode apagar para todos mensagens enviadas por você.",
        });
        return;
      }
      const pk = String(mid);
      const preview = snippetFromMsg(msg).slice(0, 120);
      const isMedia = isRichMediaMessage(msg);
      const ok = window.confirm(
        isMedia
          ? `Apagar para todos esta mídia?\n\n` +
              `• Só é permitido para mensagens que você enviou.\n` +
              `• A conversa passará a mostrar um aviso no lugar da mídia.\n` +
              `• A remoção no WhatsApp depende do provedor (UltraMsg).\n\n` +
              `Prévia: "${preview || "(mídia)"}"\n(id ${pk})`
          : `Apagar para todos esta mensagem?\n\n"${preview || "(sem texto)"}"\n\nSomente esta mensagem (id ${pk}) será substituída por um aviso.`
      );
      if (!ok) return;
      try {
        const res = await excluirMensagem(conversaId, mid);
        marcarMensagemApagadaParaTodos(mid, { euQueApaguei: true });
        if (res?.texto) {
          useConversaStore.getState().patchMensagem(mid, {
            texto: res.texto,
            apagada_para_todos: true,
            reply_meta: null,
          });
        }
        showToast({
          type: "success",
          title: "Apagada para todos",
          message: "A mensagem foi substituída por um aviso nesta conversa.",
        });
      } catch (e) {
        console.error("Erro ao excluir mensagem:", e);
        const apiMsg = e?.response?.data?.error;
        showToast({
          type: "error",
          title: "Falha ao apagar",
          message: apiMsg || "Não foi possível apagar a mensagem.",
        });
      }
    },
    [conversaId, myUserId, showToast, marcarMensagemApagadaParaTodos]
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!conversaId) return;
    const ids = Array.from(selectedSet);
    if (ids.length === 0) return;
    const ok = window.confirm(`Apagar ${ids.length} mensagem(ns) selecionada(s) do sistema?`);
    if (!ok) return;
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await excluirMensagem(conversaId, id, { scope: "me" });
      }
      showToast({ type: "success", title: "Apagadas", message: `${ids.length} mensagem(ns) removida(s).` });
      exitSelectMode();
    } catch (e) {
      console.error("Erro ao excluir selecionadas:", e);
      showToast({ type: "error", title: "Falha ao apagar", message: "Algumas mensagens podem não ter sido apagadas." });
    }
  }, [conversaId, selectedSet, exitSelectMode, showToast]);

  const flashMessageById = useCallback((msgId) => {
    if (!msgId) return;
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(String(msgId))
        : String(msgId).replace(/"/g, '\\"');
    const el = document.querySelector(`[data-msg-id="${escaped}"]`);
    if (!el) return;
    el.classList.remove("highlight-reply");
    void el.offsetWidth;
    el.classList.add("highlight-reply");
    window.setTimeout(() => el.classList.remove("highlight-reply"), 1700);
  }, []);

  const scrollToMsg = useCallback((msgId) => {
    if (!msgId) return;
    const scrollBehavior = headerCompact ? "auto" : "smooth";
    const list = mensagensComSeparadoresRef.current;
    const idx = list.findIndex((it) => it && it.__type === "msg" && String(it.id) === String(msgId));
    if (idx >= 0 && virtualThreadRef.current?.scrollToIndex) {
      virtualThreadRef.current.scrollToIndex(idx, { align: "center", behavior: scrollBehavior });
      window.setTimeout(() => flashMessageById(msgId), 260);
      return;
    }
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(String(msgId))
        : String(msgId).replace(/"/g, '\\"');
    const el = document.querySelector(`[data-msg-id="${escaped}"]`);
    el?.scrollIntoView?.({ behavior: scrollBehavior, block: "center" });
    window.setTimeout(() => flashMessageById(msgId), 260);
  }, [flashMessageById, headerCompact]);

  const handleSelectMessageSearchResult = useCallback(
    async (msg) => {
      const msgId = msg?.id;
      if (!msgId || !conversaId) return;

      let loaded = (useConversaStore.getState().mensagens || []).some((m) => String(m?.id) === String(msgId));
      let attempts = 0;
      while (!loaded && attempts < 20) {
        const st = useConversaStore.getState();
        if (String(st.selectedId ?? "") !== String(conversaId)) return;
        if (!st.hasMore || st.loadingMore) break;
        attempts += 1;
        // eslint-disable-next-line no-await-in-loop
        await st.loadMore();
        loaded = (useConversaStore.getState().mensagens || []).some((m) => String(m?.id) === String(msgId));
      }

      if (headerCompact) setMessageSearchOpen(false);
      if (loaded) {
        window.setTimeout(() => scrollToMsg(msgId), headerCompact ? 120 : 0);
        return;
      }

      showToast({
        type: "info",
        title: "Mensagem encontrada",
        message: "O resultado existe no histórico, mas não foi possível posicionar a conversa automaticamente.",
      });
    },
    [conversaId, headerCompact, scrollToMsg, showToast]
  );

  const jumpToReply = useCallback((replyToId) => {
    const rid = safeString(replyToId);
    if (!rid) return;

    const list = Array.isArray(mensagens) ? mensagens : [];
    const byWaId = list.find((m) => safeString(m?.whatsapp_id) && String(m.whatsapp_id) === rid);
    if (byWaId?.id) return scrollToMsg(byWaId.id);

    // fallback: se veio id numérico do banco
    if (/^\d{1,15}$/.test(rid)) return scrollToMsg(rid);

    showToast({
      type: "info",
      title: "Mensagem não encontrada",
      message: "A mensagem respondida não está carregada neste histórico.",
    });
  }, [mensagens, scrollToMsg, showToast]);

  /** Fecha modal de encaminhar (se aberto) e sai do modo seleção — botão X estilo WhatsApp. */
  const dismissSelectionOverlay = useCallback(() => {
    closeForward();
    exitSelectMode();
  }, [closeForward, exitSelectMode]);

  const onEscape = useCallback(() => {
    if (composerRef.current?.isRecording?.()) {
      composerRef.current?.cancelRecording?.();
    } else {
      composerRef.current?.closePanels?.();
    }
    if (showTimeline) setShowTimeline(false);
    if (tagsOpen) setTagsOpen(false);
    if (pendingFile) clearPending();
    if (showClienteSide) setShowClienteSide(false);
    if (showTransferirSetor) setShowTransferirSetor(false);
    if (forwardOpen || selectMode) dismissSelectionOverlay();
    if (msgInfoOpen) {
      setMsgInfoOpen(false);
      setMsgInfo(null);
    }
    if (pixModalOpen) setPixModalOpen(false);
    if (replyTo) setReplyTo(null);
  }, [
    showTimeline,
    tagsOpen,
    pendingFile,
    clearPending,
    showClienteSide,
    showTransferirSetor,
    dismissSelectionOverlay,
    forwardOpen,
    selectMode,
    msgInfoOpen,
    pixModalOpen,
    replyTo,
  ]);

  useGlobalHotkeys({
    onToggleTimeline: () => setShowTimeline((v) => !v),
    onFocusInput: focusMessageInput,
    onEscape,
    disabled: loading,
  });

  const handleConversarContact = useCallback(
    async (meta) => {
      if (!meta?.telefone) {
        showToast({ type: "warning", title: "Telefone indisponível", message: "Este contato não possui número para iniciar conversa." });
        return;
      }
      try {
        const data = await abrirConversaPorTelefone(meta.nome || "Contato", meta.telefone);
        const conv = data?.conversa ?? conversaFromContatoResponse(data) ?? null;
        if (!conv?.id) throw new Error("Não foi possível abrir a conversa.");
        try { useChatStore.getState().addChat(conv); } catch {}
        setSelectedId(conv.id);
        carregarConversa(conv.id);
        showToast({ type: "success", title: "Conversa aberta", message: `Conversa com ${meta.nome || "contato"} iniciada.` });
      } catch (e) {
        console.error("Erro ao abrir conversa do contato:", e);
        showToast({
          type: "error",
          title: "Falha ao abrir conversa",
          message: e.response?.data?.error || e.message || "Não foi possível abrir a conversa com este contato.",
        });
      }
    },
    [showToast, setSelectedId, carregarConversa]
  );

  const handleAdicionarGrupoContact = useCallback((meta) => {
    if (!meta?.telefone) {
      showToast({ type: "warning", title: "Telefone indisponível", message: "Este contato não possui número." });
      return;
    }
    setAddToGroupModal({ open: true, telefone: meta.telefone, nome: meta.nome || "Contato" });
  }, [showToast]);

  const closeAddToGroupModal = useCallback(() => {
    setAddToGroupModal({ open: false, telefone: null, nome: null });
    setAddToGroupGrupos([]);
    setAddToGroupSending(false);
  }, []);

  const confirmAddToGroup = useCallback(
    async (grupo) => {
      if (!grupo?.id || !addToGroupModal?.telefone || addToGroupSending) return;
      setAddToGroupSending(true);
      try {
        await api.post(`/chats/${grupo.id}/participantes`, { telefone: addToGroupModal.telefone });
        showToast({ type: "success", title: "Adicionado", message: `${addToGroupModal.nome} foi adicionado ao grupo.` });
        closeAddToGroupModal();
      } catch (e) {
        const status = e?.response?.status;
        const msg = e?.response?.data?.error || e.message;
        if (status === 404 || status === 501 || msg?.toLowerCase?.().includes("not found") || msg?.toLowerCase?.().includes("não suportado")) {
          showToast({
            type: "info",
            title: "Funcionalidade indisponível",
            message: "Adicionar contato a grupo pode não estar disponível nesta instância.",
          });
        } else {
          showToast({ type: "error", title: "Falha ao adicionar", message: msg || "Não foi possível adicionar ao grupo." });
        }
      } finally {
        setAddToGroupSending(false);
      }
    },
    [addToGroupModal, addToGroupSending, showToast, closeAddToGroupModal]
  );

  useEffect(() => {
    if (showTimeline && conversaId) {
      carregarAtendimentos(conversaId);
    }
  }, [showTimeline, conversaId, carregarAtendimentos]);

  useEffect(() => {
    if (!addToGroupModal?.open) {
      setAddToGroupGrupos([]);
      setAddToGroupLoading(false);
      return;
    }
    const cachedChats = useChatStore.getState().chats;
    const gruposEmMemoria = (Array.isArray(cachedChats) ? cachedChats : []).filter((c) => isGroupConversation(c));
    if (gruposEmMemoria.length > 0) {
      setAddToGroupGrupos(gruposEmMemoria);
      setAddToGroupLoading(false);
      return;
    }
    setAddToGroupLoading(true);
    fetchChats()
      .then((list) => {
        const grupos = (Array.isArray(list) ? list : []).filter((c) => isGroupConversation(c));
        setAddToGroupGrupos(grupos);
      })
      .catch(() => setAddToGroupGrupos([]))
      .finally(() => setAddToGroupLoading(false));
  }, [addToGroupModal?.open]);

  useEffect(() => {
    clearPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaId]);

  const mensagensComSeparadores = useMemo(() => {
    const raw = Array.isArray(mensagens) ? mensagens : [];
    const list = [];
    const reactionsByMsgId = {};

    // Primeiro, varre a lista original para detectar mensagens de reação (tipo='reaction')
    // e anexar o emoji na mensagem imediatamente anterior (aproximação estilo WhatsApp).
    for (let i = 0; i < raw.length; i++) {
      const msg = raw[i];
      if (!msg) continue;
      const tipo = safeString(msg.tipo).toLowerCase();
      if (tipo === "reaction") {
        const text = safeString(msg.texto || msg.message || msg.body);
        let emoji = "";
        const m = text.match(/rea[cç][aã]o:\s*(.+)$/i);
        if (m && m[1]) {
          emoji = m[1].trim();
        } else if (text) {
          // fallback: último caractere visível
          emoji = text.slice(-2).trim() || text.slice(-1);
        }
        const prevMsg = list[list.length - 1];
        if (prevMsg && prevMsg.id != null && emoji) {
          reactionsByMsgId[String(prevMsg.id)] = emoji;
        }
        // não adiciona a mensagem de reação na timeline
        continue;
      }
      list.push(msg);
    }

    const out = [];

    // Chave única por remetente: telefone quando existir, senão nome (evita "nome:" vs "tel:" darem chaves diferentes).
    const senderKey = (m) => {
      if (!m) return "";
      const tel = safeString(m?.remetente_telefone);
      const n = safeString(m?.remetente_nome);
      return tel || n || "";
    };

    for (let i = 0; i < list.length; i++) {
      const msg = list[i];
      if (!msg) continue;
      const prev = list[i - 1];

      const isNewDay = i === 0 || !sameDay(prev?.criado_em, msg?.criado_em);
      if (isNewDay) {
        const label = formatDia(msg?.criado_em) || "Data";
        out.push({ __type: "day", id: `day-${label}-${i}`, label });
      }

      const outMsg = isOutgoingMessage(msg);
      const prevOut = isOutgoingMessage(prev);
      const curSender = senderKey(msg);
      const prevSender = senderKey(prev);

      // WhatsApp-like (grupos): nome só na primeira msg do bloco; depois só as mensagens.
      const showRemetente =
        isGroup &&
        !outMsg &&
        Boolean(curSender) &&
        (isNewDay || !prev || prevOut || curSender !== prevSender);

      const reaction = reactionsByMsgId[String(msg.id)];

      out.push({ ...msg, __type: "msg", __showRemetente: showRemetente, __reaction: reaction });
    }

    /* Foto/vídeo seguido de texto curto (legenda enviada em mensagem separada): une visualmente. */
    for (let i = 0; i < out.length; i++) {
      const row = out[i];
      if (row.__type !== "msg") continue;
      let prevIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if (out[j].__type === "msg") {
          prevIdx = j;
          break;
        }
      }
      if (prevIdx < 0) continue;
      const prev = out[prevIdx];
      const cur = row;
      if (!isMediaCaptionBundleTop(prev)) continue;
      if (mediaHasInlineCaption(prev)) {
        /* Legenda já no balão da mídia (envio pelo CRM). Oculta texto seguinte idêntico (eco webhook). */
        if (
          isPlainCaptionFollowMessage(cur) &&
          !messageHasReplyMeta(cur) &&
          sameCaptionBundleAuthor(prev, cur) &&
          captionFollowTimeOk(prev, cur) &&
          captionTextsEquivalent(prev, cur)
        ) {
          out.splice(i, 1);
          i -= 1;
        }
        continue;
      }
      if (!isPlainCaptionFollowMessage(cur)) continue;
      if (messageHasReplyMeta(cur)) continue;
      if (!sameCaptionBundleAuthor(prev, cur)) continue;
      if (!captionFollowTimeOk(prev, cur)) continue;
      out[prevIdx] = { ...prev, __captionBundleTop: true };
      out[i] = { ...cur, __captionBundleFollow: true };
    }

    return out;
  }, [mensagens, isGroup]);

  useLayoutEffect(() => {
    mensagensComSeparadoresRef.current = mensagensComSeparadores;
  }, [mensagensComSeparadores]);

  useEffect(() => {
    if (!import.meta?.env?.DEV) return;
    console.debug("[message-boundary] render_conversation", {
      conversa_id: conversaId,
      mensagens_filtradas: Array.isArray(mensagens) ? mensagens.length : 0,
    });
  }, [conversaId, mensagens.length]);

  const showAssumeEmptyCta = useMemo(() => {
    if (isGroup) return false;
    if (!conversa?.id || conversa?.mensagens_bloqueadas) return false;
    if (conversa?.exibir_cta_assumir_sem_mensagens !== true) return false;
    if (!canAssumir(user)) return false;
    const status = getStatusAtendimentoEffective(conversa);
    if (status === "fechada" || status === "encerrada") return false;
    const atendenteId = conversa?.atendente_id ?? null;
    const hasAtendente = atendenteId !== null && atendenteId !== "";
    if (hasAtendente) return false;
    const userRole = String(user?.role || user?.perfil || "").toLowerCase();
    const isPrivileged = userRole === "admin" || userRole === "supervisor";
    const convDepId = conversa?.departamento_id ?? null;
    const userDepIds = Array.isArray(user?.departamento_ids)
      ? user.departamento_ids.map((id) => Number(id))
      : user?.departamento_id != null
        ? [Number(user.departamento_id)]
        : [];
    const mesmaSetorOuSemRestricao =
      isPrivileged ||
      convDepId == null ||
      (userDepIds.length > 0 && userDepIds.includes(Number(convDepId)));
    return mesmaSetorOuSemRestricao;
  }, [conversa, user, isGroup]);

  const [assumeEmptyBusy, setAssumeEmptyBusy] = useState(false);
  const [reopenClosedBusy, setReopenClosedBusy] = useState(false);
  const [oldContactSyncBusy, setOldContactSyncBusy] = useState(false);

  const showReopenClosedCta = useMemo(() => {
    if (isGroup) return false;
    if (!conversa?.id) return false;
    if (!canReabrir(user)) return false;
    return isClosedAttendance(conversa);
  }, [conversa, user, isGroup]);

  const showContactOldSyncCta = useMemo(() => {
    if (isGroup) return false;
    if (!conversa?.id || conversa?.mensagens_bloqueadas) return false;
    const phone = conversa?.telefone_exibivel || conversa?.cliente_telefone || conversa?.telefone || "";
    return !!String(phone || "").trim() && !String(phone || "").trim().toLowerCase().startsWith("lid:");
  }, [conversa, isGroup]);

  const handleAssumeEmpty = useCallback(async () => {
    if (!conversaId || assumeEmptyBusy) return;
    setAssumeEmptyBusy(true);
    try {
      await assumirConversa(conversaId);
      if ((useConversaStore.getState().mensagens || []).length === 0) {
        await refresh({ silent: true });
      }
      showToast({
        type: "success",
        title: "Conversa assumida",
        message: "Você já pode enviar mensagens.",
      });
    } catch (e) {
      showToast({
        type: "error",
        title: "Erro ao assumir",
        message: e?.response?.data?.error || e?.message || "Tente novamente.",
      });
    } finally {
      setAssumeEmptyBusy(false);
    }
  }, [conversaId, assumeEmptyBusy, assumirConversa, refresh, showToast]);

  const handleReopenClosed = useCallback(async () => {
    if (!conversaId || reopenClosedBusy) return;
    setReopenClosedBusy(true);
    try {
      await reabrirConversa(conversaId);
      await refresh({ silent: true });
      showToast({
        type: "success",
        title: "Atendimento reaberto",
        message: "Você já está em atendimento nesta conversa.",
      });
    } catch (e) {
      showToast({
        type: "error",
        title: "Erro ao reabrir",
        message: e?.response?.data?.error || e?.message || "Tente novamente.",
      });
    } finally {
      setReopenClosedBusy(false);
    }
  }, [conversaId, reopenClosedBusy, reabrirConversa, refresh, showToast]);

  const handleCarregarMensagensAntigasContato = useCallback(async () => {
    if (!conversaId || oldContactSyncBusy) return;
    setOldContactSyncBusy(true);
    try {
      const res = await carregarMensagensAntigasContato(conversaId);
      await refresh({ silent: true });
      const importadas = Number(res?.mensagens_importadas || 0);
      const atualizadas = Number(res?.mensagens_atualizadas || 0);
      const alteradas = importadas + atualizadas;
      showToast({
        type: alteradas > 0 ? "success" : "info",
        title: alteradas > 0 ? "Historico carregado" : "Sem mensagens antigas",
        message: alteradas > 0
          ? `${importadas} mensagem(ns) importada(s) e ${atualizadas} atualizada(s) para este contato.`
          : (res?.message || "Nenhuma mensagem antiga encontrada para este contato."),
      });
    } catch (e) {
      showToast({
        type: "error",
        title: "Falha ao carregar historico",
        message: e?.response?.data?.error || e?.message || "Tente novamente.",
      });
    } finally {
      setOldContactSyncBusy(false);
    }
  }, [conversaId, oldContactSyncBusy, refresh, showToast]);

  const setorAtual =
    conversa?.departamento_id != null
      ? (conversa?.setor ?? conversa?.departamento?.nome ?? conversa?.departamentos?.nome ?? null)
      : null;

  const carregarDepartamentos = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard/departamentos");
      setDepartamentos(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Erro ao carregar departamentos:", e);
      setDepartamentos([]);
    }
  }, []);

  const handleOpenTransferirSetor = useCallback(() => {
    setShowTransferirSetor(true);
    carregarDepartamentos();
  }, [carregarDepartamentos]);

  const handleTransferirSetor = useCallback(
    async (departamentoId) => {
      if (!conversaId || !departamentoId || transferirSetorLoading) return;
      setTransferirSetorLoading(true);
      try {
        await api.put(`/chats/${conversaId}/departamento`, {
          departamento_id: Number(departamentoId),
        });
        await refresh({ silent: true });
        setShowTransferirSetor(false);
      } catch (e) {
        console.error("Erro ao transferir setor:", e);
        showToast({
          type: "error",
          title: "Falha ao transferir setor",
          message: e?.response?.data?.error || "Tente novamente.",
        });
      } finally {
        setTransferirSetorLoading(false);
      }
    },
    [conversaId, refresh, showToast, transferirSetorLoading]
  );

  const handleRemoverSetor = useCallback(
    async () => {
      if (!conversaId || transferirSetorLoading) return;
      setTransferirSetorLoading(true);
      try {
        await api.put(`/chats/${conversaId}/departamento`, { remover_setor: true });
        await refresh({ silent: true });
        setShowTransferirSetor(false);
        showToast({ type: "success", title: "Setor removido", message: "A conversa não possui mais setor vinculado." });
      } catch (e) {
        console.error("Erro ao remover setor:", e);
        showToast({
          type: "error",
          title: "Falha ao remover setor",
          message: e?.response?.data?.error || "Tente novamente.",
        });
      } finally {
        setTransferirSetorLoading(false);
      }
    },
    [conversaId, refresh, showToast, transferirSetorLoading]
  );

  const handleOpenAdicionarAtendente = useCallback(async () => {
    if (!conversaId || atendentesLoading) return;
    setShowAdicionarAtendente(true);
    setAtendenteSearch("");
    setAtendentesLoading(true);
    try {
      const data = await listarAtendentesDisponiveisConversa(conversaId);
      setAtendentesDisponiveis(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Erro ao listar atendentes disponiveis:", e);
      setAtendentesDisponiveis([]);
      showToast({
        type: "error",
        title: "Falha ao carregar atendentes",
        message: e?.response?.data?.error || "Tente novamente.",
      });
    } finally {
      setAtendentesLoading(false);
    }
  }, [atendentesLoading, conversaId, showToast]);

  const atendentesDisponiveisFiltrados = useMemo(() => {
    const term = safeString(atendenteSearch).toLowerCase();
    const list = Array.isArray(atendentesDisponiveis) ? atendentesDisponiveis : [];
    if (!term) return list;
    return list.filter((u) => {
      const hay = `${safeString(u.nome)} ${safeString(u.email)} ${safeString(u.perfil)}`.toLowerCase();
      return hay.includes(term);
    });
  }, [atendenteSearch, atendentesDisponiveis]);

  const handleAdicionarAtendente = useCallback(
    async (usuarioId) => {
      if (!conversaId || adicionarAtendenteLoadingId != null) return;
      const uid = Number(usuarioId);
      if (!Number.isFinite(uid) || uid <= 0) return;
      setAdicionarAtendenteLoadingId(uid);
      try {
        const res = await adicionarAtendenteConversa(conversaId, uid);
        const nomeAdicionado = res?.usuario?.nome || "Atendente";
        setShowAdicionarAtendente(false);
        setAtendentesDisponiveis([]);
        await Promise.all([
          refresh({ silent: true }),
          carregarAtendimentos(conversaId).catch(() => null),
        ]);
        showToast({
          type: "success",
          title: "Atendente adicionado",
          message: `${nomeAdicionado} agora participa deste atendimento.`,
        });
      } catch (e) {
        console.error("Erro ao adicionar atendente:", e);
        showToast({
          type: "error",
          title: "Falha ao adicionar",
          message: e?.response?.data?.error || e?.message || "Tente novamente.",
        });
      } finally {
        setAdicionarAtendenteLoadingId(null);
      }
    },
    [adicionarAtendenteLoadingId, carregarAtendimentos, conversaId, refresh, showToast]
  );

  const carregarTags = useCallback(
    async (opts = {}) => {
      const showError = opts.showErrorToUser !== false;
      try {
        setTagsLoading(true);
        const data = await listarTags();
        setAllTags(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Erro ao listar tags:", err);
        if (showError) {
          showToast({
            type: "error",
            title: "Falha ao carregar tags",
            message: "Não foi possível carregar as tags disponíveis.",
          });
        }
      } finally {
        setTagsLoading(false);
      }
    },
    [showToast]
  );

  const handleToggleTagPanel = useCallback(() => {
    setTagsOpen((prev) => {
      const next = !prev;
      if (next) {
        // ao abrir o painel, carrega tags e mostra toast só se falhar (usuário está vendo o painel)
        carregarTags({ showErrorToUser: true });
      }
      return next;
    });
  }, [carregarTags]);

  const handleToggleTag = useCallback(
    async (tag) => {
      if (!conversaId || !tag?.id) return;
      const alreadySelected = selectedTagIds.includes(String(tag.id));
      const previousTags = Array.isArray(tags) ? tags : [];
      const nextTags = alreadySelected
        ? previousTags.filter((t) => String(t.id) !== String(tag.id))
        : [...previousTags, tag];
      try {
        setTagMutatingId(tag.id);
        setTags(nextTags);
        const chatStore = useChatStore.getState();
        if (alreadySelected) {
          chatStore.removerTag(conversaId, tag.id);
        } else {
          chatStore.adicionarTag(conversaId, tag);
        }
        if (alreadySelected) {
          await removerTagConversa(conversaId, tag.id);
        } else {
          await adicionarTagConversa(conversaId, tag.id);
        }
      } catch (err) {
        if (!alreadySelected && err?.response?.status === 409) {
          return;
        }
        setTags(previousTags);
        useChatStore.getState().updateChat({ id: conversaId, tags: previousTags });
        console.error("Erro ao atualizar tag da conversa:", err);
        showToast({
          type: "error",
          title: "Falha ao atualizar tag",
          message: "Não foi possível atualizar as tags desta conversa.",
        });
      } finally {
        setTagMutatingId(null);
      }
    },
    [conversaId, selectedTagIds, setTags, showToast, tags]
  );

  // Tags: só carregamos ao abrir o painel (evita toast "falha ao carregar" em background)
  // handleToggleTagPanel já chama carregarTags() ao abrir quando allTags está vazio

  const handleComposerAppendConsumed = useCallback(() => {
    clearComposerAppendQueue();
  }, [clearComposerAppendQueue]);

  const handleComposerCancelReply = useCallback(() => setReplyTo(null), []);

  const handleComposerPasteImage = useCallback(
    (file) => handleDropFile(file),
    [handleDropFile]
  );

  const handleComposerSendAudio = useCallback(
    (file) => handleEnviarArquivo(file),
    [handleEnviarArquivo]
  );

  const handleComposerOpenPixConfig = useCallback(async () => {
    await fetchPixConfigIfNeeded();
    setPixModalOpen(true);
  }, [fetchPixConfigIfNeeded]);

  const handleCloseMsgInfo = useCallback(() => {
    setMsgInfoOpen(false);
    setMsgInfo(null);
  }, []);

  const handleClosePixModal = useCallback(() => {
    if (!pixConfigSaving) setPixModalOpen(false);
  }, [pixConfigSaving]);

  const handleCallDurationChange = useCallback((raw) => {
    const v = Number(raw) || 0;
    if (v < 1) setCallDuration(1);
    else if (v > 15) setCallDuration(15);
    else setCallDuration(v);
  }, []);

  const handleCallConfirm = useCallback(async () => {
    if (!conversaId || callSending) return;
    const dur = Math.min(15, Math.max(1, Number(callDuration) || 5));
    setCallSending(true);
    try {
      await registrarLigacao(conversaId, dur);
      setCallModalOpen(false);
      showToast({
        type: "success",
        title: "Ligação registrada",
        message: "A ligação via WhatsApp foi registrada na conversa.",
      });
    } catch (err) {
      console.error("Erro ao registrar ligação:", err);
      const is403 = err?.response?.status === 403;
      const apiMsg = err?.response?.data?.error;
      showToast({
        type: "error",
        title: is403 ? "Acesso restrito" : "Falha ao registrar ligação",
        message:
          apiMsg ||
          (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível registrar a ligação."),
      });
    } finally {
      setCallSending(false);
    }
  }, [conversaId, callSending, callDuration, showToast]);

  const mensagensBloqueadasHint = Boolean(conversa?.mensagens_bloqueadas);
  const atendimentoEncerradoHint = !isGroup && isClosedAttendance(conversa);
  const atendenteNomeHint = conversa?.atendente_nome ?? "";

  /* Só tela cheia sem shell; com header da lista o thread mostra “Carregando mensagens…” inline. */
  if (!headerCompact && loading && !conversa) {
    return <ConversaLoadingScreen />;
  }

  if (!conversa) {
    if (selectedId && loadError) {
      return (
        <div className="wa-empty">
          <div className="wa-empty-card">
            <div className="wa-empty-title">Não foi possível abrir a conversa</div>
            <div className="wa-empty-sub">
              {loadError || "Selecione outra na lista ou tente novamente."}
            </div>
            <button
              type="button"
              className="wa-btn wa-btn-primary"
              style={{ marginTop: 12 }}
              onClick={() => carregarConversa(selectedId)}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="wa-empty">
        <EmptyState
          title="Selecione uma conversa"
          description="Abra uma conversa na lista à esquerda para visualizar e responder às mensagens."
        />
      </div>
    );
  }

  return (
    <div ref={waShellRef} className="wa-shell" onDragEnter={onDragEnter}>
        <ChatToast toast={toast} onClose={() => setToast(null)} />

        {dragOver ? (
          <div
            className="wa-dropOverlay"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            role="presentation"
          >
            <div className="wa-dropCard">
              <div className="wa-dropTitle">Solte para anexar</div>
              <div className="wa-dropSub">Envie imagens e arquivos diretamente na conversa.</div>
            </div>
          </div>
        ) : null}

        <ConversaHeader
          headerRef={waHeaderRef}
          onBack={handleBackToList}
          isGroup={isGroup}
          headerCompact={headerCompact}
          headerAtendCompact={headerAtendCompact}
          headerCrmAtivoLayout={headerCrmAtivoLayout}
          nome={nome}
          avatar={avatar}
          avatarUrl={avatarUrl}
          showAvatarImg={showAvatarImg}
          onAvatarError={handleHeaderAvatarError}
          onAvatarClick={onHeaderAvatarClick}
          badge={badge}
          showPagamentoConcluidoBadge={showPagamentoConcluidoBadge}
          encerramentoAusenciaHint={encerramentoAusenciaHint}
          setorAtual={setorAtual}
          podeTransferirSetor={podeTransferirSetor}
          onOpenTransferirSetor={handleOpenTransferirSetor}
          podeAdicionarAtendente={podeAdicionarAtendente}
          onOpenAdicionarAtendente={handleOpenAdicionarAtendente}
          isSomeoneTyping={isSomeoneTyping}
          podeGerenciarTags={podeGerenciarTags}
          tagsOpen={tagsOpen}
          onToggleTagPanel={handleToggleTagPanel}
          conversaId={conversaId}
          showTimeline={showTimeline}
          onToggleTimeline={toggleTimeline}
          mostrarEnviarCrm={mostrarEnviarCrm}
          sendCrmRef={sendCrmRef}
          canConsultarProdutos={canConsultarProdutos}
          showProdutosPanel={showProdutosPanel}
          onOpenProdutosPanel={handleOpenProdutosPanel}
          onOpenClienteSide={handleOpenClienteSide}
          onOpenMessageSearch={() => setMessageSearchOpen(true)}
          whatsappInstanceLabel={whatsappInstanceLabel}
        />

        <ConversaMessageSearchPanel
          open={messageSearchOpen}
          conversaId={conversaId}
          onClose={() => setMessageSearchOpen(false)}
          onSelectResult={handleSelectMessageSearchResult}
        />

        {!isGroup && podeTransferirSetor && showTransferirSetor && (
          <>
            <button
              type="button"
              className="wa-floatingSheet-backdrop"
              aria-label="Fechar painel de setor"
              onClick={() => setShowTransferirSetor(false)}
            />
          <div
            className="wa-tagsPanel wa-tagsPanel--setor"
            role="dialog"
            aria-label="Transferir setor"
          >
            <div className="wa-tagsPanel-head">
              <span className="wa-tagsPanel-title">Transferir setor</span>
              <button
                type="button"
                className="wa-iconBtn"
                onClick={() => setShowTransferirSetor(false)}
                title="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-tagsPanel-body">
              {departamentos.length === 0 ? (
                <div className="wa-muted">Carregando setores...</div>
              ) : (
                <div className="wa-tagsList">
                  {departamentos.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="wa-tagItem"
                      onClick={() => handleTransferirSetor(d.id)}
                      disabled={transferirSetorLoading || Number(d.id) === Number(conversa?.departamento_id)}
                    >
                      {d.nome}
                      {Number(d.id) === Number(conversa?.departamento_id) ? " (atual)" : ""}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="wa-tagItem wa-tagItem--remover"
                onClick={handleRemoverSetor}
                disabled={transferirSetorLoading || !conversa?.departamento_id}
                title={conversa?.departamento_id ? "Remover setor da conversa" : "Conversa já está sem setor"}
              >
                Sem setor
              </button>
              {transferirSetorLoading && (
                <div className="wa-muted" style={{ marginTop: 8 }}>Salvando...</div>
              )}
            </div>
          </div>
          </>
        )}

        {!isGroup && podeAdicionarAtendente && showAdicionarAtendente && (
          <>
            <button
              type="button"
              className="wa-floatingSheet-backdrop"
              aria-label="Fechar painel de atendentes"
              onClick={() => setShowAdicionarAtendente(false)}
            />
          <div
            className="wa-tagsPanel wa-tagsPanel--setor"
            role="dialog"
            aria-label="Adicionar atendente"
          >
            <div className="wa-tagsPanel-head">
              <span className="wa-tagsPanel-title">Adicionar atendente</span>
              <button
                type="button"
                className="wa-iconBtn"
                onClick={() => setShowAdicionarAtendente(false)}
                title="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-tagsPanel-body">
              <input
                className="wa-transferSearch"
                value={atendenteSearch}
                onChange={(e) => setAtendenteSearch(e.target.value)}
                placeholder="Buscar por nome ou email"
                autoFocus
              />
              {atendentesLoading ? (
                <div className="wa-muted">Carregando atendentes...</div>
              ) : atendentesDisponiveisFiltrados.length === 0 ? (
                <div className="wa-muted">Nenhum atendente disponivel.</div>
              ) : (
                <div className="wa-tagsList">
                  {atendentesDisponiveisFiltrados.map((u) => {
                    const uid = Number(u.usuario_id ?? u.id);
                    const busy = adicionarAtendenteLoadingId === uid;
                    return (
                      <button
                        key={uid}
                        type="button"
                        className="wa-tagItem"
                        onClick={() => handleAdicionarAtendente(uid)}
                        disabled={adicionarAtendenteLoadingId != null}
                        title={u.email || u.nome || "Atendente"}
                      >
                        <span>{u.nome || u.email || "Atendente"}</span>
                        {u.perfil ? <span className="wa-muted"> {u.perfil}</span> : null}
                        {busy ? " adicionando..." : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </>
        )}

        {!isGroup && podeGerenciarTags && tagsOpen && (
          <>
            <button
              type="button"
              className="wa-floatingSheet-backdrop"
              aria-label="Fechar painel de tags"
              onClick={() => handleToggleTagPanel()}
            />
          <div className="wa-tagsPanel wa-tagsPanel--tags" role="dialog" aria-label="Tags da conversa">
            <div className="wa-tagsPanel-head">
              <span className="wa-tagsPanel-title">Tags do cliente</span>
              <button
                type="button"
                className="wa-iconBtn"
                onClick={handleToggleTagPanel}
                title="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-tagsPanel-body">
              {tagsLoading && allTags.length === 0 ? (
                <div className="wa-muted">Carregando tags...</div>
              ) : allTags.length === 0 ? (
                <div className="wa-muted">Nenhuma tag cadastrada.</div>
              ) : (
                <div className="wa-tagsList">
                  {allTags.map((tag) => {
                    const selected = selectedTagIds.includes(String(tag.id));
                    const busy = tagMutatingId === tag.id;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`wa-tagChip ${selected ? "isSelected" : ""}`}
                        onClick={() => handleToggleTag(tag)}
                        disabled={busy}
                      >
                        <span className="wa-tagChip-label">{tag.nome}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </>
        )}

        {showClienteSide ? (
          <Suspense fallback={null}>
            <button
              type="button"
              className="wa-floatingSheet-backdrop wa-floatingSheet-backdrop--cliente"
              aria-label="Fechar dados do cliente"
              onClick={() => setShowClienteSide(false)}
            />
            <SidebarCliente
              open
              onClose={() => setShowClienteSide(false)}
              conversa={conversa}
              isGroup={isGroup}
              tags={tags}
              tempoSemResponder={tempoSemResponder}
              onObservacaoSaved={refresh}
            />
          </Suspense>
        ) : null}

        {/* TIMELINE */}
        {showTimeline ? (
          <div className="wa-timeline" role="region" aria-label="Historico do atendimento">
            <div className="wa-timeline-head">
              <div className="wa-timeline-headLeft">
                <span className="wa-timeline-title">Histórico</span>
                <span className="wa-timeline-sub">Eventos, transferências e notas desta conversa (Esc para fechar)</span>
              </div>

              <button onClick={handleCloseTimeline} className="wa-iconBtn" title="Fechar (Esc)" type="button">
                <IconClose />
              </button>
            </div>

            <div className="wa-timeline-body">
              {atendimentosLoading ? (
                <div className="wa-muted">Carregando...</div>
              ) : (atendimentos || []).length === 0 ? (
                <div className="wa-muted">Sem histórico ainda.</div>
              ) : (
                <div className="wa-timeline-list">
                  {(atendimentos || []).map((a) => (
                    <div key={a.id || `${a.acao}-${a.criado_em}`} className="wa-timeline-card">
                      <div className="wa-timeline-row">
                        <span className="wa-timeline-time">{formatHoraCurta(a.criado_em)}</span>
                        <span className="wa-timeline-label">{timelineEventLabel(a, conversa)}</span>
                      </div>
                      {a.observacao ? (
                        <div className="wa-timeline-nota">Nota interna: {a.observacao}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* MENSAGENS */}
        <div
          ref={messagesContainerRef}
          className={`wa-messages${selectMode ? " wa-messages--selectDim" : ""}`}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragLeave={onDragLeave}
          role="log"
          aria-label="Mensagens"
        >
          <ConversaSelectionBar
            open={selectMode}
            forwardSelectIntent={forwardSelectIntent}
            compactMessageUx={compactMessageUx}
            selectedCount={selectedSet.size}
            forwardSending={forwardSending}
            onDismiss={dismissSelectionOverlay}
            onForward={handleForwardAdvance}
            onDelete={handleDeleteSelected}
          />
          {!selectMode && pinnedTop ? (
            <div className="wa-pinBar" role="button" tabIndex={0} onClick={() => scrollToMsg(pinnedTop.id)}>
              <span className="wa-pinBar-ic" aria-hidden="true">📌</span>
              <span className="wa-pinBar-text">Fixada: {snippetFromMsg(pinnedTop)}</span>
              <span className="wa-pinBar-hint">Ver</span>
            </div>
          ) : null}

          <ConversaThread
            virtualThreadRef={virtualThreadRef}
            messagesContainerRef={messagesContainerRef}
            scrollThreadId={scrollThreadId}
            conversaId={conversaId}
            headerCompact={headerCompact}
            mensagensComSeparadores={mensagensComSeparadores}
            mensagens={mensagens}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            cursor={cursor}
            conversa={conversa}
            showAssumeEmptyCta={showAssumeEmptyCta}
            assumeEmptyBusy={assumeEmptyBusy}
            onAssumeEmpty={handleAssumeEmpty}
            showReopenClosedCta={showReopenClosedCta}
            reopenClosedBusy={reopenClosedBusy}
            onReopenClosed={handleReopenClosed}
            showContactOldSyncCta={showContactOldSyncCta}
            contactOldSyncBusy={oldContactSyncBusy}
            onContactOldSync={handleCarregarMensagensAntigasContato}
            onLoadOlderMessagesClick={handleLoadOlderMessagesClick}
            onVirtualContentResize={snapIfStickBottom}
            BubbleComponent={Bubble}
            zapSeenMsgKeysRef={zapSeenMsgKeysRef}
            zapMsgsInitialPassRef={zapMsgsInitialPassRef}
            isGroup={isGroup}
            avatarUrl={avatarUrl}
            nome={nome}
            selectMode={selectMode}
            selectedSet={selectedSet}
            pinnedSet={pinnedSet}
            starredSet={starredSet}
            localReactions={localReactions}
            reactionLoading={reactionLoading}
            myUserId={myUserId}
            mostrarNomeAoCliente={user?.mostrar_nome_ao_cliente !== false}
            swipeReplyEnabled={headerCompact && !selectMode}
            compactMessageUx={compactMessageUx}
            onToggleSelected={toggleSelected}
            onInfo={handleInfoAction}
            onReply={handleReplyAction}
            onCopy={handleCopyResult}
            onForward={handleForwardAction}
            onTogglePin={togglePin}
            onToggleStar={toggleStar}
            onStartSelect={startSelect}
            onDeleteForMe={handleDeleteForMe}
            onDeleteForEveryone={handleDeleteForEveryone}
            onJumpToReply={jumpToReply}
            onOpenMedia={openMediaViewer}
            onReact={handleSendReaction}
            onRemoveReaction={handleRemoveReaction}
            onConversarContact={handleConversarContact}
            onAdicionarGrupoContact={handleAdicionarGrupoContact}
          />

          <div ref={bottomRef} />
        </div>

        <PendingMediaPreview
          pendingFile={pendingFile}
          pendingPreview={pendingPreview}
          pendingCaption={pendingCaption}
          onCaptionChange={setPendingCaption}
          sending={sending}
          headerCompact={headerCompact}
          rootRef={mediaPreviewRootRef}
          captionRef={pendingCaptionRef}
          onCancel={clearPending}
          onConfirmSendFile={handleConfirmSendFile}
          onConfirmSendImageMobile={handleConfirmSendImageMobile}
        />

        {forwardOpen && forwardMsgs?.length ? (
          <Suspense fallback={null}>
            <ForwardModal
              open={forwardOpen}
              forwardMsgs={forwardMsgs}
              forwardPreviewLabel={forwardPreviewLabel}
              forwardQuery={forwardQuery}
              onForwardQueryChange={setForwardQuery}
              forwardSending={forwardSending}
              forwardSelectedConversaIds={forwardSelectedConversaIds}
              forwardMax10Msg={forwardMax10Msg}
              forwardMultiProgress={forwardMultiProgress}
              forwardColaboradoresLoading={forwardColaboradoresLoading}
              forwardColaboradoresFiltered={forwardColaboradoresFiltered}
              forwardCandidates={forwardCandidates}
              forwardClientesLoading={forwardClientesLoading}
              forwardClientes={forwardClientes}
              onClose={closeForward}
              onConfirmForwardToColaborador={confirmForwardToColaborador}
              onToggleForwardConversaSelect={toggleForwardConversaSelect}
              onConfirmForwardTo={confirmForwardTo}
              onConfirmForwardToCliente={confirmForwardToCliente}
              onConfirmForwardToMany={confirmForwardToMany}
            />
          </Suspense>
        ) : null}

        {pixModalOpen ? (
          <Suspense fallback={null}>
            <PixConfigModal
              open={pixModalOpen}
              tipoChave={pixTipoChave}
              chave={pixChave}
              nomeRecebedor={pixNomeRecebedor}
              mensagemPadrao={pixMensagemPadrao}
              saving={pixConfigSaving}
              loading={pixConfigLoading}
              onClose={handleClosePixModal}
              onTipoChaveChange={setPixTipoChave}
              onChaveChange={setPixChave}
              onNomeRecebedorChange={setPixNomeRecebedor}
              onMensagemPadraoChange={setPixMensagemPadrao}
              onSave={() => handleSalvarPixConfig()}
            />
          </Suspense>
        ) : null}

        {msgInfoOpen && msgInfo ? (
          <Suspense fallback={null}>
            <MsgInfoModal open={msgInfoOpen} msgInfo={msgInfo} onClose={handleCloseMsgInfo} />
          </Suspense>
        ) : null}

        {mediaViewer ? (
          <Suspense fallback={null}>
            <MediaViewerOverlay
              mediaViewer={mediaViewer}
              mediaPdfBlobUrl={mediaPdfBlobUrl}
              mediaPdfLoading={mediaPdfLoading}
              mediaPdfError={mediaPdfError}
              mediaPrintLoading={mediaPrintLoading}
              mediaViewerImgRef={mediaViewerImgRef}
              mediaViewerVideoRef={mediaViewerVideoRef}
              onClose={closeMediaViewer}
              onPrint={handleMediaViewerPrint}
            />
          </Suspense>
        ) : null}

        {shareContactOpen ? (
          <Suspense fallback={null}>
            <ShareContactModal
              open={shareContactOpen}
              query={shareContactQuery}
              onQueryChange={setShareContactQuery}
              list={shareContactList}
              loading={shareContactLoading}
              sending={shareContactSending}
              onClose={handleShareContactClose}
              onSelectContact={handleShareContactSelect}
            />
          </Suspense>
        ) : null}

        {shareLocationOpen ? (
          <Suspense fallback={null}>
            <ShareLocationModal
              open={shareLocationOpen}
              geoLoading={shareLocationGeoLoading}
              geoError={shareLocationGeoError}
              lat={shareLocationLat}
              lng={shareLocationLng}
              nome={shareLocationNome}
              endereco={shareLocationEndereco}
              sending={shareLocationSending}
              onClose={handleShareLocationClose}
              onLatChange={setShareLocationLat}
              onLngChange={setShareLocationLng}
              onNomeChange={setShareLocationNome}
              onEnderecoChange={setShareLocationEndereco}
              onSend={handleEnviarLocalizacao}
            />
          </Suspense>
        ) : null}

        {showProdutosPanel && !isGroup && canConsultarProdutos ? (
          <Suspense fallback={null}>
            <ProdutoConsultaPanel
              open
              onClose={() => setShowProdutosPanel(false)}
              canViewSyncStatus={canVerSyncProdutos}
              canTriggerManualSync={canSincronizarProdutos}
              showToast={showToast}
              onEnviarParaConversa={(template) => queueComposerAppend(template)}
            />
          </Suspense>
        ) : null}

        {addToGroupModal?.open ? (
          <Suspense fallback={null}>
            <AddToGroupModal
              open
              contactNome={addToGroupModal?.nome}
              grupos={addToGroupGrupos}
              loading={addToGroupLoading}
              sending={addToGroupSending}
              onClose={closeAddToGroupModal}
              onSelectGroup={confirmAddToGroup}
            />
          </Suspense>
        ) : null}

        {callModalOpen ? (
          <Suspense fallback={null}>
            <CallModal
              open={callModalOpen}
              duration={callDuration}
              sending={callSending}
              conversaId={conversaId}
              onClose={() => !callSending && setCallModalOpen(false)}
              onDurationChange={handleCallDurationChange}
              onConfirm={handleCallConfirm}
            />
          </Suspense>
        ) : null}

        <ConversaComposer
          ref={composerRef}
          conversaId={conversaId}
          departamentoId={conversa?.departamento_id ?? null}
          scrollThreadId={scrollThreadId}
          loading={loading}
          sending={sending}
          podeEnviar={podeEnviar}
          autoAssumirHint={conversaElegivelAutoAssumir}
          mensagensBloqueadasHint={mensagensBloqueadasHint}
          atendimentoEncerradoHint={atendimentoEncerradoHint}
          atendenteNomeHint={atendenteNomeHint}
          headerCompact={headerCompact}
          composerEnterInsertsNewline={composerEnterInsertsNewline}
          autocorrectToggleInMenu={autocorrectToggleInMenu}
          user={user}
          replyBarPreview={replyBarPreview}
          onCancelReply={handleComposerCancelReply}
          onSendMessage={handleEnviar}
          onSendAudioFile={handleComposerSendAudio}
          onPasteImageFile={handleComposerPasteImage}
          onFileInputChange={handleFileInputChange}
          onFototecaInputChange={handleFototecaInputChange}
          onDocumentInputChange={handleDocumentInputChange}
          onCameraInputChange={handleCameraInputChange}
          onStickerInputChange={handleStickerInputChange}
          onSendStickerFile={sendStickerFile}
          onPixMenuClick={handlePixMenuClick}
          onOpenPixConfig={handleComposerOpenPixConfig}
          onShareContact={openShareContact}
          onShareLocation={openShareLocation}
          pixActionBusy={pixActionBusy}
          pixConfigLoading={pixConfigLoading}
          appendTextQueue={composerAppendQueue}
          onAppendConsumed={handleComposerAppendConsumed}
          onAppendTextApplied={handleComposerAppendApplied}
          onTextMetrics={handleComposerTextMetrics}
          clearTyping={clearTyping}
          showToast={showToast}
        />

        {/* ESC handler central */}
        <button
          type="button"
          className="wa-escCatcher"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onEscape}
          style={{ display: "none" }}
        />
    </div>
  );
}

/** Gate leve: não monta o painel pesado durante loading (crítico no mobile + aba Todas). */
export default function ConversaView() {
  const { loading, selectedId, conversa, loadError, carregarConversa } = useConversaStore(
    (s) => ({
      loading: s.loading,
      selectedId: s.selectedId,
      conversa: s.conversa,
      loadError: s.loadError,
      carregarConversa: s.carregarConversa,
    }),
    shallow
  );
  const headerCompact = useMatchMedia("(max-width: 640px)");

  if (headerCompact && (selectedId == null || selectedId === "")) {
    return null;
  }

  if (headerCompact && loadError && !loading) {
      return (
      <div className="wa-empty">
        <div className="wa-empty-card">
          <div className="wa-empty-title">Não foi possível abrir a conversa</div>
          <div className="wa-empty-sub">
            {loadError || "Selecione outra na lista ou tente novamente."}
          </div>
          <button
            type="button"
            className="wa-btn wa-btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => carregarConversa(selectedId)}
          >
            Tentar novamente
          </button>
        </div>
      </div>
      );
  }

  /* conversa já vem da lista no carregarConversa — monta o painel e mostra "Carregando mensagens…" no thread. */
  if (headerCompact && loading && !conversa) {
    return <ConversaLoadingScreen />;
  }

  return <ConversaViewBody />;
}
