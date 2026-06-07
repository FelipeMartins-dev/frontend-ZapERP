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
import { abrirConversaPorTelefone, conversaFromContatoResponse } from "../chats/chatService";
import { getDisplayName } from "../chats/chatListDisplay";
import { getSocket } from "../socket/socket";
import { scheduleAfterInitialPaint } from "../chats/scheduleAfterInitialPaint";
import { saveReplyMeta } from "./replyMeta";
import {
  buildOptimisticOutgoingMessage,
  bumpChatListWithOptimisticMessage,
  normalizeArquivoApiToMessage,
} from "./conversaOptimisticMessage";
import {
  isNearBottom,
  captureMessagesScrollAnchor,
  restoreMessagesScrollAnchor,
} from "./scrollUtils";
import ConversaThread from "./ConversaThread";
import ConversaComposer from "./ConversaComposer";

import { FORWARD_SELECT_MAX, STICKER_RECENTS_LIMIT } from "./conversaConstants";
import {
  parseToDate,
  formatDia,
  sameDay,
  safeString,
  isFilenameOnlyText,
  isOutgoingMessage,
  isMediaCaptionBundleTop,
  isPlainCaptionFollowMessage,
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
import {
  listarTags,
  adicionarTagConversa,
  removerTagConversa,
} from "../api/tagService";
import * as cfg from "../api/configService";
import { useMatchMedia } from "../hooks/useMatchMedia";
import EmptyState from "../components/feedback/EmptyState";
import ConversaLoadingScreen from "./ConversaLoadingScreen";
import "../components/feedback/empty-state.css";
import "../components/feedback/skeleton.css";
import "../components/feedback/toast.css";




/* =========================================================
   Hooks
========================================================= */


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
  const myUserId = user?.id != null ? Number(user.id) : null;
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

  const podeEnviar = useMemo(() => {
    if (!user?.id || !conversa?.id) return false;
    /** Grupos: qualquer usuário pode enviar sem assumir atendimento (modelo WhatsApp). */
    if (isGroupConversation(conversa)) return true;
    if (isClosedAttendance(conversa)) return false;
    if (conversa?.mensagens_bloqueadas) return false;
    const atendenteId = conversa?.atendente_id ?? null;
    if (atendenteId == null || atendenteId === "") return false;
    return String(atendenteId) === String(user.id);
  }, [user?.id, conversa, conversa?.atendente_id, conversa?.id, conversa?.mensagens_bloqueadas]);

  const [showTimeline, setShowTimeline] = useState(false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [sending, setSending] = useState(false);

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
  /** Bloqueia snap automático ao fundo (Assumir, etc.). */
  const suppressAutoScrollRef = useRef(false);
  const messagesScrollPreserveSnapRef = useRef(null);
  const [allTags, setAllTags] = useState([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagMutatingId, setTagMutatingId] = useState(null);
  const [showClienteSide, setShowClienteSide] = useState(false);
  const [showTransferirSetor, setShowTransferirSetor] = useState(false);
  const [departamentos, setDepartamentos] = useState([]);
  const [transferirSetorLoading, setTransferirSetorLoading] = useState(false);
  const [showRespostasSalvas, setShowRespostasSalvas] = useState(false);
  const [respostasSalvas, setRespostasSalvas] = useState([]);
  const [respostasSalvasLoading, setRespostasSalvasLoading] = useState(false);
  const [showProdutosPanel, setShowProdutosPanel] = useState(false);

  const chats = useChatStore((s) => s.chats);
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
    pendingBlobUrlRef.current = pendingPreview || null;
  }, [pendingPreview]);

  useEffect(
    () => () => {
      const url = pendingBlobUrlRef.current;
      if (url && String(url).startsWith("blob:")) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
    },
    []
  );

  const conversaId = conversa?.id || null;

  /** Enquanto `carregarConversa` limpa `conversa`, `selectedId` mantém o chat — necessário para scroll até à última mensagem não falhar a meio do load. */
  const scrollThreadId =
    selectedId != null && selectedId !== "" ? selectedId : conversaId;

  useEffect(() => {
    setMessageSearchOpen(false);
  }, [conversaId]);

  /* Mobile: cabeçalho fixo (viewport) + padding no shell; teclado via visualViewport e foco no input */
  useLayoutEffect(() => {
    const shell = waShellRef.current;
    const header = waHeaderRef.current;
    const input = composerRef.current?.getInputElement?.() ?? null;
    if (!shell || !header) return;

    const mq = window.matchMedia("(max-width: 640px)");
    const syncMobileInputFocusClass = () => {
      const isFocused = Boolean(input && document.activeElement === input);
      shell.classList.toggle("wa-mobile-input-focused", mq.matches && isFocused);
    };

    const syncHeaderLayout = () => {
      if (!mq.matches) {
        shell.style.removeProperty("--wa-mobile-header-h");
        shell.style.removeProperty("--wa-vv-top");
        shell.style.removeProperty("--wa-keyboard-inset");
        shell.style.removeProperty("--wa-visual-height");
        shell.classList.remove("wa-mobile-input-focused");
        return;
      }
      shell.style.setProperty("--wa-mobile-header-h", `${header.offsetHeight}px`);
      const vvNow = window.visualViewport;
      if (vvNow) {
        shell.style.setProperty("--wa-vv-top", `${vvNow.offsetTop}px`);
        const ih = window.innerHeight;
        const kbInset = Math.max(0, ih - vvNow.height - vvNow.offsetTop);
        shell.style.setProperty("--wa-keyboard-inset", `${kbInset}px`);
        shell.style.setProperty("--wa-visual-height", `${vvNow.height}px`);
      } else {
        shell.style.removeProperty("--wa-keyboard-inset");
        shell.style.removeProperty("--wa-visual-height");
      }
      syncMobileInputFocusClass();
    };

    syncHeaderLayout();

    const ro = new ResizeObserver(syncHeaderLayout);
    ro.observe(header);

    const onMqChange = () => syncHeaderLayout();
    if (mq.addEventListener) mq.addEventListener("change", onMqChange);
    else mq.addListener(onMqChange);

    const vv = window.visualViewport;
    const onVv = () => syncHeaderLayout();
    if (vv) {
      vv.addEventListener("resize", onVv);
      vv.addEventListener("scroll", onVv);
    }

    const onInputFocusBlur = () => requestAnimationFrame(syncHeaderLayout);
    if (input) {
      input.addEventListener("focus", onInputFocusBlur);
      input.addEventListener("blur", onInputFocusBlur);
    }

    return () => {
      ro.disconnect();
      if (mq.removeEventListener) mq.removeEventListener("change", onMqChange);
      else mq.removeListener(onMqChange);
      if (vv) {
        vv.removeEventListener("resize", onVv);
        vv.removeEventListener("scroll", onVv);
      }
      if (input) {
        input.removeEventListener("focus", onInputFocusBlur);
        input.removeEventListener("blur", onInputFocusBlur);
      }
      shell.classList.remove("wa-mobile-input-focused");
      shell.style.removeProperty("--wa-mobile-header-h");
      shell.style.removeProperty("--wa-vv-top");
      shell.style.removeProperty("--wa-keyboard-inset");
      shell.style.removeProperty("--wa-visual-height");
    };
  }, [conversaId]);

  const isSomeoneTyping = Boolean(
    typingInfo &&
    typingInfo.usuario_id !== myUserId &&
    (typingInfo.expiresAt == null || typingInfo.expiresAt > Date.now())
  );

  const isGroup = useMemo(() => isGroupConversation(conversa), [conversa]);

  // Nunca exibir LID (lid:xxx) como nome ou número — identificador interno do WhatsApp
  const isLidValue = (v) => v != null && String(v).trim().toLowerCase().startsWith("lid:");

  const fromChat = useMemo(
    () => (Array.isArray(chats) ? chats.find((c) => String(c?.id) === String(conversaId)) : null),
    [chats, conversaId]
  );

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

  /** Aberta / finalizada: setor e ação ficam na linha abaixo do pill de status (mobile/desktop). */
  const headerSetorBelowStatus = useMemo(() => {
    if (!conversa || isGroupConversation(conversa)) return false;
    const s = safeString(getStatusAtendimentoEffective(conversa)).toLowerCase();
    return s === "aberta" || s === "fechada" || s === "mensagem_disparada";
  }, [conversa]);

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
    const ultimaIn = [...list].reverse().find((m) => m?.direcao === "in");
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
    if (!c || loadingMore) return;
    if (!shouldStickToBottomRef.current) return;
    const list = useConversaStore.getState().mensagens || [];
    const last = list.length ? list[list.length - 1] : null;
    shouldStickToBottomRef.current = true;
    if (last && isPendingOutgoingTemp(last)) {
      snapThreadToBottom(c, virtualThreadRef, { min: true });
      return;
    }
    if (!isNearBottom(c, 200)) return;
    snapThreadToBottom(c, virtualThreadRef, { gentle: true, nearThreshold: 200 });
  }, [loadingMore]);

  /** Evita animação zapAnimateIn na bolha otimista (parece “pulo” ao enviar). */
  const markOptimisticSeen = useCallback(
    (msg) => {
      if (!msg || conversaId == null) return;
      zapSeenMsgKeysRef.current.add(getMessageListReactKey(msg, conversaId));
    },
    [conversaId]
  );

  const snapOptimisticSendToBottom = useCallback(() => {
    const snap = () => {
      const c = messagesContainerRef.current;
      if (!c) return;
      snapThreadToBottom(c, virtualThreadRef, { min: true });
    };
    snap();
    if (typeof window !== "undefined") {
      window.requestAnimationFrame?.(snap);
      window.setTimeout?.(snap, 80);
    }
  }, []);

  const appendOutgoingOptimisticMessage = useCallback(
    (optimisticMsg, opts = {}) => {
      if (!optimisticMsg) return;
      shouldStickToBottomRef.current = true;
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

    const patch = {
      id: conversaId,
      status_atendimento: "em_atendimento",
      status_atendimento_real: "em_atendimento",
      aguardando_cliente_desde: new Date().toISOString(),
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
  });

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
    setPendingFile(null);
    setPendingPreview(null);
    setPendingCaption("");
  }, [pendingPreview]);

  const openMediaSendPreview = useCallback((file) => {
    if (!file) return;
    if (isArquivoBloqueadoWhatsApp(file)) {
      showToast({
        type: "error",
        title: "Arquivo não permitido",
        message: mensagemArquivoBloqueadoWhatsApp(file),
      });
      return;
    }
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
  }, [showToast]);

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
  /** Um único agendamento por frame para loadMore — evita spam na API e trabalho síncrono em cada evento de scroll (touch). */
  const loadMoreScrollRafRef = useRef(0);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    shouldStickToBottomRef.current = isNearBottom(el, 120);

    const st = useConversaStore.getState();
    if (!st.hasMore || st.loadingMore || !st.cursor) return;
    if (loadMoreScrollRafRef.current) return;
    loadMoreScrollRafRef.current = requestAnimationFrame(() => {
      loadMoreScrollRafRef.current = 0;
      const el2 = messagesContainerRef.current;
      if (!el2) return;
      const cur = useConversaStore.getState();
      if (!cur.hasMore || cur.loadingMore || !cur.cursor) return;
      if (el2.scrollTop < 140) {
        loadMoreScrollRef.current = { top: el2.scrollTop, height: el2.scrollHeight };
        cur.loadMore();
      }
    });
  }, []);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleMessagesScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleMessagesScroll);
  }, [handleMessagesScroll, conversaId]);

  useEffect(() => {
    return () => {
      if (loadMoreScrollRafRef.current) {
        cancelAnimationFrame(loadMoreScrollRafRef.current);
        loadMoreScrollRafRef.current = 0;
      }
    };
  }, [conversaId]);

  useEffect(() => {
    if (loadingMore) return;
    const { top, height } = loadMoreScrollRef.current;
    if (top === 0 && height === 0) return;
    const el = messagesContainerRef.current;
    if (!el) return;
    const diff = el.scrollHeight - height;
    if (diff > 0) {
      el.scrollTop = top + diff;
    }
    loadMoreScrollRef.current = { top: 0, height: 0 };
  }, [loadingMore]);

  /** Mesma estratégia do scroll ao topo: grava altura/scroll antes do `loadMore` para restaurar posição após o lote. */
  const handleLoadOlderMessagesClick = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const st = useConversaStore.getState();
    if (!st.hasMore || st.loadingMore || !st.cursor || st.conversa?.mensagens_bloqueadas) return;
    loadMoreScrollRef.current = { top: el.scrollTop, height: el.scrollHeight };
    st.loadMore();
  }, []);

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

      setSending(true);
      try {
        const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData, {
          headers: { "Content-Type": false },
        });

        const realMsg = normalizeArquivoApiToMessage(data, conversaId);
        if (realMsg?.id != null || realMsg?.whatsapp_id) {
          reconciliarMensagem(tempId, realMsg);
        } else if (
          !opts.waitSocketOnly &&
          (!data?.id || Number(data?.conversa_id) !== Number(conversaId))
        ) {
          const targetId = conversaId;
          scheduleAfterInitialPaint(() => {
            const st = useConversaStore.getState();
            if (String(st.selectedId) !== String(targetId)) return;
            void st.refresh({ silent: true });
          }, 400);
        }
      } catch (err) {
        revertOutgoingStatus?.();
        console.error("Erro ao enviar arquivo:", err);
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
        setSending(false);
        focusMessageInput();
      }
    },
    [
      conversaId,
      showToast,
      clearPending,
      podeEnviar,
      focusMessageInput,
      reconciliarMensagem,
      marcarMensagemTempErro,
      appendOutgoingOptimisticMessage,
      applyOutgoingStatusOptimistic,
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
      const tempIds = [];
      shouldStickToBottomRef.current = true;
      const revertOutgoingStatus = applyOutgoingStatusOptimistic();
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const optimisticMsg = buildOptimisticOutgoingMessage({ conversaId, file: f });
        tempIds.push(optimisticMsg.tempId);
        appendOutgoingOptimisticMessage(optimisticMsg, { bumpList: i === files.length - 1 });
      }

      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("file", files[i]);
      }
      setSending(true);
      try {
        const { data } = await api.post(`/chats/${conversaId}/arquivo`, formData, {
          headers: { "Content-Type": false },
        });
        const responseIds = Array.isArray(data?.ids) && data.ids.length > 0
          ? data.ids
          : data?.id != null
            ? [data.id]
            : [];
        responseIds.forEach((id, idx) => {
          const tempId = tempIds[idx];
          if (!tempId || id == null || String(id).trim() === "") return;
          reconciliarMensagem(tempId, {
            id,
            conversa_id: Number(conversaId),
            direcao: "out",
            status: "pending",
            status_mensagem: "pending",
          });
        });
        if (
          responseIds.length < tempIds.length ||
          (!responseIds.length && (!data?.id || Number(data?.conversa_id) !== Number(conversaId)))
        ) {
          const targetId = conversaId;
          scheduleAfterInitialPaint(() => {
            const st = useConversaStore.getState();
            if (String(st.selectedId) !== String(targetId)) return;
            void st.refresh({ silent: true });
          }, 400);
        }
      } catch (err) {
        revertOutgoingStatus?.();
        console.error("Erro ao enviar fotos da galeria:", err);
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        tempIds.forEach((tid) => marcarMensagemTempErro(tid, { erro_mensagem: apiMsg || err?.message }));
        showToast({
          type: "error",
          title: is403 ? "Acesso restrito" : "Falha ao enviar",
          message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar as fotos. Tente novamente."),
        });
      } finally {
        setSending(false);
        focusMessageInput();
      }
    },
    [
      conversaId,
      podeEnviar,
      showToast,
      focusMessageInput,
      marcarMensagemTempErro,
      reconciliarMensagem,
      appendOutgoingOptimisticMessage,
      applyOutgoingStatusOptimistic,
    ]
  );

  const handleConfirmSendFile = useCallback(async () => {
    if (!pendingFile || confirmSendLockRef.current) return;
    confirmSendLockRef.current = true;
    try {
      const captionToSend = pendingCaption;
      await handleEnviarArquivo(pendingFile, { caption: captionToSend });
    } finally {
      confirmSendLockRef.current = false;
    }
  }, [pendingFile, pendingCaption, handleEnviarArquivo]);

  const handleConfirmSendImageMobile = useCallback(
    async ({ sendAsOriginal, croppedAreaPixels, rotation, fileName, mimeType }) => {
      if (!pendingFile || !pendingPreview || confirmSendLockRef.current) return;
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
    [pendingFile, pendingPreview, pendingCaption, handleEnviarArquivo]
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
        const mime = String(fileToSend.type || "").toLowerCase();
        const ext = String(fileToSend.name || "").toLowerCase();
        const isWebp = mime === "image/webp" || ext.endsWith(".webp");
        await handleEnviarArquivo(fileToSend, { forceStickerType: !isWebp, waitSocketOnly: true });
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

  const handleEnviar = useCallback(async (forcedText) => {
    if (!conversaId) return;
    if (enviarTextoEmAndamentoRef.current) return;
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
    const t = safeString(forcedLooksLikeEvent ? undefined : forcedText);
    if (!t) return;
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

    let envioFalhou = false;
    enviarTextoEmAndamentoRef.current = true;
    setSending(true);
    try {
      const res = await enviarMensagem(conversaId, t, replyMeta || undefined);
      const resMsgId = res?.mensagem?.id ?? res?.id;
      const realMsg = normalizeArquivoApiToMessage(res, conversaId);
      if (realMsg?.id != null || realMsg?.whatsapp_id) {
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
      composerRef.current?.setText?.(t);
      if (replyTo) setReplyTo(replyTo);
      showToast({
        type: "error",
        title: is403 ? "Acesso restrito" : "Falha ao enviar",
        message: apiMsg || (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar a mensagem. Verifique sua conexão."),
      });
      focusMessageInput();
    } finally {
      enviarTextoEmAndamentoRef.current = false;
      setSending(false);
    }
    if (!envioFalhou) {
      focusMessageInput();
    }
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
    focusMessageInput,
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
    chats,
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
        await excluirMensagem(conversaId, id);
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
    const list = mensagensComSeparadoresRef.current;
    const idx = list.findIndex((it) => it && it.__type === "msg" && String(it.id) === String(msgId));
    if (idx >= 0 && virtualThreadRef.current?.scrollToIndex) {
      virtualThreadRef.current.scrollToIndex(idx, { align: "center", behavior: "smooth" });
      window.setTimeout(() => flashMessageById(msgId), 260);
      return;
    }
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(String(msgId))
        : String(msgId).replace(/"/g, '\\"');
    const el = document.querySelector(`[data-msg-id="${escaped}"]`);
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    window.setTimeout(() => flashMessageById(msgId), 260);
  }, [flashMessageById]);

  const handleSelectMessageSearchResult = useCallback(
    async (msg) => {
      const msgId = msg?.id;
      if (!msgId || !conversaId) return;

      let loaded = (useConversaStore.getState().mensagens || []).some((m) => String(m?.id) === String(msgId));
      let attempts = 0;
      while (!loaded && attempts < 80) {
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
    if (showRespostasSalvas) setShowRespostasSalvas(false);
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
    showRespostasSalvas,
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
    const gruposEmMemoria = (Array.isArray(chats) ? chats : []).filter((c) => isGroupConversation(c));
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
  }, [addToGroupModal?.open, chats]);

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
      if (!isPlainCaptionFollowMessage(cur)) continue;
      if (messageHasReplyMeta(cur)) continue;
      if (!sameCaptionBundleAuthor(prev, cur)) continue;
      if (!captionFollowTimeOk(prev, cur)) continue;
      out[prevIdx] = { ...prev, __captionBundleTop: true };
      out[i] = { ...cur, __captionBundleFollow: true };
    }

    return out;
  }, [mensagens, isGroup]);

  mensagensComSeparadoresRef.current = mensagensComSeparadores;

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

  const showReopenClosedCta = useMemo(() => {
    if (isGroup) return false;
    if (!conversa?.id) return false;
    if (!canReabrir(user)) return false;
    return isClosedAttendance(conversa);
  }, [conversa, user, isGroup]);

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

  const carregarRespostasSalvas = useCallback(async () => {
    try {
      setRespostasSalvasLoading(true);
      const depId = conversa?.departamento_id || null;
      const list = await cfg.getRespostasSalvas(depId);
      setRespostasSalvas(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("Erro ao carregar respostas salvas:", e);
      setRespostasSalvas([]);
    } finally {
      setRespostasSalvasLoading(false);
    }
  }, [conversa?.departamento_id]);

  const handleOpenRespostasSalvas = useCallback(() => {
    setShowRespostasSalvas(true);
    carregarRespostasSalvas();
  }, [carregarRespostasSalvas]);

  const handleInserirResposta = useCallback(
    (textoResposta) => {
      if (!textoResposta) return;
      composerRef.current?.appendText?.(textoResposta);
      setShowRespostasSalvas(false);
      focusMessageInput();
    },
    [focusMessageInput]
  );

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
          headerSetorBelowStatus={headerSetorBelowStatus}
          setorAtual={setorAtual}
          podeTransferirSetor={podeTransferirSetor}
          onOpenTransferirSetor={handleOpenTransferirSetor}
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
            onLoadOlderMessagesClick={handleLoadOlderMessagesClick}
            onVirtualContentResize={headerCompact ? undefined : snapIfStickBottom}
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

        {showRespostasSalvas && (
          <div
            className="wa-tagsPanel"
            role="dialog"
            aria-label="Respostas salvas"
            style={{ bottom: "100%", left: 0, right: 0, maxHeight: 220 }}
          >
            <div className="wa-tagsPanel-head">
              <span className="wa-tagsPanel-title">Respostas rápidas</span>
              <button
                type="button"
                className="wa-iconBtn"
                onClick={() => setShowRespostasSalvas(false)}
                title="Fechar"
              >
                <IconClose />
              </button>
            </div>
            <div className="wa-tagsPanel-body" style={{ maxHeight: 160, overflowY: "auto" }}>
              {respostasSalvasLoading ? (
                <div className="wa-muted">Carregando...</div>
              ) : respostasSalvas.length === 0 ? (
                <div className="wa-muted">Nenhuma resposta salva. Configure em Configurações &gt; Respostas salvas.</div>
              ) : (
                <div className="wa-tagsList">
                  {respostasSalvas.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="wa-tagItem"
                      onClick={() => handleInserirResposta(r.texto)}
                      title={r.titulo}
                    >
                      <strong>{r.titulo}</strong>
                      <span className="wa-muted" style={{ fontSize: 12, marginTop: 2, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {String(r.texto || "").slice(0, 60)}
                        {(r.texto || "").length > 60 ? "…" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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
          scrollThreadId={scrollThreadId}
          loading={loading}
          sending={sending}
          podeEnviar={podeEnviar}
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
