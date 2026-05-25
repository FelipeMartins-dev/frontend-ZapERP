import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "../../chats/chatsStore";
import { scheduleAfterInitialPaint } from "../../chats/scheduleAfterInitialPaint";
import { fetchChats, abrirConversaCliente } from "../../chats/chatService";
import {
  getForwardColaboradoresCache,
  loadForwardColaboradoresOnce,
  setForwardColaboradoresCache,
} from "../forwardDestinationsCache";
import { forwardAtendimentoMessageToColaborador } from "../../api/internalChatService";
import {
  enviarMensagem,
  encaminharArquivo,
  encaminharMensagemViaAPI,
  assumirChat,
} from "../conversaService";
import { FORWARD_SELECT_MAX, FORWARD_DEST_MAX } from "../conversaConstants";
import { safeString, formatForwardHttpError, getMediaUrl } from "../utils/conversaViewHelpers";
import { snippetFromMsg } from "../utils/conversaMessageDisplay";
import * as cfg from "../../api/configService";
import { useConversaStore } from "../conversaStore";
import {
  pushOptimisticForwardToDest,
  reconcileForwardOptimisticTemps,
} from "../conversaOptimisticMessage";

function buildForwardText(m) {
  if (!m) return "";
  const t = safeString(m?.texto);
  if (t) return `[Encaminhado]\n${t}`;
  const url = getMediaUrl(m?.url, m?.url_absoluta);
  const nome = safeString(m?.nome_arquivo);
  if (url) return `[Encaminhado]\n${nome ? `${nome}\n` : ""}${url}`;
  return "[Encaminhado]\n(mídia)";
}

/**
 * Estado e lógica do fluxo de encaminhamento (modal, destinos, APIs).
 * Seleção múltipla (selectMode) permanece no ConversaView.
 */
export function useForwardFlow({ conversa, conversaId, chats, user, showToast, exitSelectMode }) {
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardMsgs, setForwardMsgs] = useState(null);
  const [forwardQuery, setForwardQuery] = useState("");
  const [forwardSending, setForwardSending] = useState(false);
  const [forwardClientes, setForwardClientes] = useState([]);
  const [forwardClientesLoading, setForwardClientesLoading] = useState(false);
  const [forwardColaboradores, setForwardColaboradores] = useState([]);
  const [forwardColaboradoresLoading, setForwardColaboradoresLoading] = useState(false);
  const [forwardSelectedConversaIds, setForwardSelectedConversaIds] = useState([]);
  const [forwardMax10Msg, setForwardMax10Msg] = useState("");
  const [forwardMultiProgress, setForwardMultiProgress] = useState(null);
  const forwardMax10TimerRef = useRef(null);
  /** Evita duplo clique; não bloqueia o modal (envio segue em background). */
  const forwardJobLockRef = useRef(false);

  const forwardCandidates = useMemo(() => {
    const list = Array.isArray(chats) ? chats : [];
    const q = safeString(forwardQuery).toLowerCase();
    const byName = (c) => {
      const n = safeString(c?.contato_nome || c?.nome || c?.cliente?.nome || c?.telefone);
      const at = safeString(c?.atendente_nome ?? c?.atendenteNome);
      const atMail = safeString(c?.atendente_email ?? c?.atendenteEmail);
      const tel = safeString(c?.telefone);
      const telEx = safeString(c?.telefone_exibivel ?? c?.telefoneExibivel);
      if (!q) return true;
      const hay = `${n} ${at} ${atMail} ${tel} ${telEx}`.toLowerCase();
      return hay.includes(q);
    };
    return list
      .filter((c) => c?.id != null && String(c.id) !== String(conversaId))
      .filter(byName)
      .slice(0, 80);
  }, [chats, forwardQuery, conversaId]);

  const forwardColaboradoresFiltered = useMemo(() => {
    const list = Array.isArray(forwardColaboradores) ? forwardColaboradores : [];
    const me = user?.id != null ? String(user.id) : null;
    const semEu = me
      ? list.filter((colab) => {
          const uid = colab?.id ?? colab?.user_id ?? colab?.usuario_id;
          return uid == null || String(uid) !== me;
        })
      : list;
    const q = safeString(forwardQuery).toLowerCase();
    if (!q) return semEu.slice(0, 80);
    return semEu
      .filter((colab) => {
        const n = safeString(colab?.nome ?? colab?.name ?? colab?.full_name).toLowerCase();
        const em = safeString(colab?.email).toLowerCase();
        return n.includes(q) || em.includes(q);
      })
      .slice(0, 80);
  }, [forwardColaboradores, forwardQuery, user?.id]);

  const forwardPreviewLabel = useMemo(() => {
    if (!forwardMsgs?.length) return "";
    if (forwardMsgs.length === 1) return snippetFromMsg(forwardMsgs[0]);
    const first = snippetFromMsg(forwardMsgs[0]);
    return `${first} · e mais ${forwardMsgs.length - 1} mensagem(ns)`;
  }, [forwardMsgs]);

  // Encaminhar: GET /chats com colaboradores + busca de clientes (contatos)
  useEffect(() => {
    if (!forwardOpen) {
      setForwardClientes([]);
      setForwardClientesLoading(false);
      setForwardColaboradores([]);
      setForwardColaboradoresLoading(false);
      return;
    }

    let cancelled = false;
    const cachedCols = getForwardColaboradoresCache();
    if (cachedCols != null) {
      setForwardColaboradores(cachedCols);
      setForwardColaboradoresLoading(false);
    } else {
      setForwardColaboradoresLoading(true);
    }

    const cancelColabSchedule = scheduleAfterInitialPaint(() => {
      if (cancelled) return;
      loadForwardColaboradoresOnce(async () => {
        const parsed = await fetchChats({
          incluir_todos_clientes: true,
          incluir_colaboradores_encaminhar: true,
        });
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.conversas)) {
          useChatStore.getState().setChats(parsed.conversas);
          const cols = Array.isArray(parsed.colaboradores_encaminhar) ? parsed.colaboradores_encaminhar : [];
          setForwardColaboradoresCache(cols);
          return cols;
        }
        setForwardColaboradoresCache([]);
        return [];
      })
        .then((cols) => {
          if (cancelled) return;
          setForwardColaboradores(cols);
        })
        .catch(() => {
          if (!cancelled) setForwardColaboradores([]);
        })
        .finally(() => {
          if (!cancelled) setForwardColaboradoresLoading(false);
        });
    }, 0);

    const q = safeString(forwardQuery).trim();
    let clientesTimer = null;
    if (q.length < 2) {
      setForwardClientes([]);
      setForwardClientesLoading(false);
    } else {
      setForwardClientesLoading(true);
      clientesTimer = setTimeout(async () => {
        if (cancelled) return;
        try {
          const list = await cfg.getClientes({ palavra: q, limit: 60 });
          if (cancelled) return;
          const arr = Array.isArray(list) ? list : [];
          const curClienteId = conversa?.cliente_id != null ? String(conversa.cliente_id) : null;
          setForwardClientes(curClienteId ? arr.filter((c) => String(c.id) !== curClienteId) : arr);
        } catch (_) {
          if (!cancelled) setForwardClientes([]);
        } finally {
          if (!cancelled) setForwardClientesLoading(false);
        }
      }, 260);
    }

    return () => {
      cancelled = true;
      cancelColabSchedule();
      if (clientesTimer) clearTimeout(clientesTimer);
    };
  }, [forwardOpen, forwardQuery, conversa?.cliente_id]);

  useEffect(
    () => () => {
      if (forwardMax10TimerRef.current) {
        clearTimeout(forwardMax10TimerRef.current);
        forwardMax10TimerRef.current = null;
      }
    },
    []
  );

  const closeForward = useCallback(() => {
    if (forwardMax10TimerRef.current) {
      clearTimeout(forwardMax10TimerRef.current);
      forwardMax10TimerRef.current = null;
    }
    setForwardOpen(false);
    setForwardMsgs(null);
    setForwardQuery("");
    setForwardSending(false);
    setForwardSelectedConversaIds([]);
    setForwardMax10Msg("");
    setForwardMultiProgress(null);
  }, []);

  const resetForwardFlow = useCallback(() => {
    closeForward();
  }, [closeForward]);

  useEffect(() => {
    resetForwardFlow();
  }, [conversaId, resetForwardFlow]);

  const openForwardWithMsgs = useCallback((msgs) => {
    if (!msgs?.length) return;
    setForwardMsgs(msgs);
    setForwardQuery("");
    setForwardSelectedConversaIds([]);
    setForwardOpen(true);
  }, []);

  const openForwardFromSelection = useCallback(
    (orderedSelectedIds, mensagens) => {
      if (!orderedSelectedIds?.length) return;
      const byId = new Map((mensagens || []).filter((m) => m?.id).map((m) => [String(m.id), m]));
      const orderedMsgs = orderedSelectedIds.map((id) => byId.get(String(id))).filter(Boolean);
      if (!orderedMsgs.length) {
        showToast({
          type: "warning",
          title: "Mensagens indisponíveis",
          message: "Não foi possível resolver as mensagens selecionadas nesta conversa.",
        });
        return;
      }
      const capped = orderedMsgs.slice(0, FORWARD_SELECT_MAX);
      if (orderedMsgs.length > capped.length) {
        showToast({
          type: "info",
          title: "Limite",
          message: `Encaminhando as primeiras ${FORWARD_SELECT_MAX} mensagens selecionadas.`,
        });
      }
      openForwardWithMsgs(capped);
    },
    [showToast, openForwardWithMsgs]
  );

  const toggleForwardConversaSelect = useCallback((rawId) => {
    if (rawId == null) return;
    const s = String(rawId);
    setForwardSelectedConversaIds((prev) => {
      if (prev.includes(s)) return prev.filter((x) => x !== s);
      if (prev.length >= FORWARD_DEST_MAX) {
        setForwardMax10Msg("Máximo de 10 contatos.");
        if (forwardMax10TimerRef.current) clearTimeout(forwardMax10TimerRef.current);
        forwardMax10TimerRef.current = setTimeout(() => {
          setForwardMax10Msg("");
          forwardMax10TimerRef.current = null;
        }, 4000);
        return prev;
      }
      return [...prev, s];
    });
  }, []);

  const resolveDestConversaMeta = useCallback(
    (destConversaId) => {
      const list = Array.isArray(chats) ? chats : [];
      return list.find((c) => String(c?.id) === String(destConversaId)) || null;
    },
    [chats]
  );

  const applyForwardOptimisticFor = useCallback(
    (destConversaId, msgs) => {
      const list = Array.isArray(msgs) ? msgs : [];
      if (!list.length || destConversaId == null) return [];
      const st = useConversaStore.getState();
      return pushOptimisticForwardToDest(
        destConversaId,
        list,
        resolveDestConversaMeta(destConversaId),
        {
          selectedId: st.selectedId,
          anexarMensagemImediata: st.anexarMensagemImediata,
        }
      );
    },
    [resolveDestConversaMeta]
  );

  const execEncaminharFor = useCallback(
    async (destConversaId, msgs, opts = {}) => {
      const { quietBatchItemToasts = false } = opts;
      const list = Array.isArray(msgs) ? msgs : [];
      if (!list.length) return null;

      const orderedIds = list.map((m) => m.id).filter((id) => id != null);
      if (!orderedIds.length) {
        for (const m of list) {
          // eslint-disable-next-line no-await-in-loop
          await enviarMensagem(destConversaId, buildForwardText(m));
        }
        return null;
      }

      if (orderedIds.length === 1) {
        const forwardMsg = list[0];
        const tipo = String(forwardMsg?.tipo || "").toLowerCase();
        const hasMediaUrl = !!(forwardMsg?.url || forwardMsg?.url_absoluta);
        try {
          const apiRes = await encaminharMensagemViaAPI(destConversaId, forwardMsg.id);
          if (apiRes?.kind === "single") return apiRes;
          return { kind: "single", mensagem: apiRes?.mensagem ?? apiRes };
        } catch (e) {
          console.warn("Encaminhar via API falhou, tentando fallback:", e?.response?.data?.error || e?.message);
          if (hasMediaUrl && (tipo === "arquivo" || tipo === "imagem" || tipo === "video" || tipo === "vídeo")) {
            try {
              await encaminharArquivo(destConversaId, forwardMsg, getMediaUrl);
              return null;
            } catch (e2) {
              console.warn("Fallback arquivo também falhou:", e2);
            }
          }
          await enviarMensagem(destConversaId, buildForwardText(forwardMsg));
        }
        return null;
      }

      const res = await encaminharMensagemViaAPI(destConversaId, orderedIds);
      if (!res || res.kind !== "batch") {
        throw new Error("Resposta de encaminhamento em lote inválida.");
      }
      const items = res.encaminhamentos || [];
      if (!items.length) {
        throw new Error("Resposta de encaminhamento em lote sem itens.");
      }
      let okCount = 0;
      let failCount = 0;
      for (const item of items) {
        if (item?.ok) {
          okCount++;
        } else if (item && item.ok === false) {
          failCount++;
          if (!quietBatchItemToasts) {
            const hint = item.mensagem_id != null ? ` (#${item.mensagem_id})` : "";
            showToast({
              type: "error",
              title: "Falha ao encaminhar",
              message: String(item.error || item.status || `Item${hint}`),
            });
          }
        }
      }
      if (okCount === 0 && items.length) {
        throw new Error("Nenhuma mensagem foi encaminhada.");
      }
      return {
        kind: "batch",
        encaminhamentos: items,
        successes: okCount,
        failures: failCount,
        total: items.length,
      };
    },
    [showToast]
  );

  const releaseForwardUi = useCallback(
    ({ destCount = 1, msgCount } = {}) => {
      const n = msgCount ?? 0;
      closeForward();
      exitSelectMode?.();
      showToast({
        type: "info",
        title: "Encaminhando",
        message:
          destCount > 1
            ? `Enviando para ${destCount} conversa(s) em segundo plano. Você pode continuar usando o sistema.`
            : n > 1
              ? `Enviando ${n} mensagens em segundo plano.`
              : "Mensagem sendo encaminhada em segundo plano.",
      });
    },
    [closeForward, exitSelectMode, showToast]
  );

  const processForwardToDest = useCallback(
    async (destConversaId, msgs, tempIds, { quietBatchItemToasts = false } = {}) => {
      const convStore = useConversaStore.getState();
      const stats = await execEncaminharFor(destConversaId, msgs, { quietBatchItemToasts });
      reconcileForwardOptimisticTemps(tempIds, stats, convStore.reconciliarMensagem);
      let assumeError = null;
      try {
        await assumirChat(destConversaId);
      } catch (ae) {
        assumeError = formatForwardHttpError(ae);
      }
      return { stats, assumeError };
    },
    [execEncaminharFor]
  );

  const runForwardInBackground = useCallback(
    (job) => {
      void (async () => {
        try {
          await job();
        } catch (e) {
          console.error("Erro no encaminhamento em background:", e);
          showToast({
            type: "error",
            title: "Encaminhamento",
            message: formatForwardHttpError(e),
          });
        } finally {
          forwardJobLockRef.current = false;
          try {
            useChatStore.getState().requestChatListResync();
          } catch (_) {}
        }
      })();
    },
    [showToast]
  );

  const confirmForwardToMany = useCallback(() => {
    const ids = (forwardSelectedConversaIds || []).filter((x) => x != null && String(x) !== "");
    const msgs = Array.isArray(forwardMsgs) ? [...forwardMsgs] : [];
    if (ids.length < 1 || ids.length > FORWARD_DEST_MAX || !msgs.length) return;
    if (forwardJobLockRef.current) return;
    forwardJobLockRef.current = true;

    const jobs = ids.map((destId) => ({
      destId,
      tempIds: applyForwardOptimisticFor(destId, msgs),
    }));

    releaseForwardUi({ destCount: ids.length, msgCount: msgs.length });

    runForwardInBackground(async () => {
      const forwardOk = [];
      const forwardFail = [];
      const assumeFail = [];

      for (const { destId, tempIds } of jobs) {
        try {
          const { stats, assumeError } = await processForwardToDest(destId, msgs, tempIds, {
            quietBatchItemToasts: true,
          });
          forwardOk.push(destId);
          if (stats?.failures > 0) {
            /* lote parcial — POST aceitou; assumir segue */
          }
          if (assumeError) {
            assumeFail.push({ id: destId, error: assumeError });
          }
        } catch (e) {
          const errMsg = formatForwardHttpError(e);
          tempIds.forEach((tid) =>
            useConversaStore.getState().marcarMensagemTempErro(tid, { erro_mensagem: errMsg })
          );
          forwardFail.push({ id: destId, error: errMsg });
        }
      }

      if (forwardOk.length > 0 && forwardFail.length === 0 && assumeFail.length === 0) {
        showToast({
          type: "success",
          title: "Encaminhamento concluído",
          message: `Concluído para ${forwardOk.length} destino(s).`,
        });
      } else if (forwardOk.length > 0) {
        const bits = [];
        if (forwardFail.length) {
          bits.push(
            `Falha em ${forwardFail.length} destino(s): ${forwardFail.map((f) => `#${f.id}`).join(", ")}.`
          );
        }
        if (assumeFail.length) {
          bits.push(
            `Não foi possível assumir em ${assumeFail.length} destino(s): ${assumeFail.map((a) => `#${a.id}`).join(", ")}.`
          );
        }
        showToast({ type: "warning", title: "Resultado parcial", message: bits.join(" ") });
      } else {
        showToast({
          type: "error",
          title: "Falha ao encaminhar",
          message: forwardFail.map((f) => f.error).filter(Boolean).join(" · ") || "Não foi possível encaminhar.",
        });
      }
    });
  }, [
    forwardSelectedConversaIds,
    forwardMsgs,
    applyForwardOptimisticFor,
    releaseForwardUi,
    runForwardInBackground,
    processForwardToDest,
    showToast,
  ]);

  const confirmForwardTo = useCallback(
    (destConversaId) => {
      const msgs = Array.isArray(forwardMsgs) ? [...forwardMsgs] : [];
      if (!destConversaId || !msgs.length || forwardJobLockRef.current) return;
      forwardJobLockRef.current = true;

      const tempIds = applyForwardOptimisticFor(destConversaId, msgs);
      releaseForwardUi({ destCount: 1, msgCount: msgs.length });

      runForwardInBackground(async () => {
      const n = msgs.length;
      try {
        const { stats, assumeError } = await processForwardToDest(destConversaId, msgs, tempIds);
        if (stats?.failures > 0) {
          showToast({
            type: "info",
            title: "Encaminhamento parcial",
            message: `${stats.successes} de ${stats.total} encaminhada(s); ${stats.failures} falha(s).`,
          });
        } else {
          showToast({
            type: "success",
            title: n > 1 ? "Encaminhadas" : "Encaminhada",
            message: n > 1 ? `${n} mensagens encaminhadas.` : "Mensagem encaminhada.",
          });
        }
        if (assumeError) {
          showToast({
            type: "warning",
            title: "Encaminhado, mas não foi possível assumir",
            message: assumeError,
          });
        }
      } catch (e) {
        const errMsg = formatForwardHttpError(e);
        tempIds.forEach((tid) =>
          useConversaStore.getState().marcarMensagemTempErro(tid, { erro_mensagem: errMsg })
        );
        showToast({ type: "error", title: "Falha ao encaminhar", message: errMsg });
      }
    });
    },
    [forwardMsgs, applyForwardOptimisticFor, releaseForwardUi, runForwardInBackground, processForwardToDest, showToast]
  );

  const confirmForwardToCliente = useCallback(
    (cliente) => {
      const msgs = Array.isArray(forwardMsgs) ? [...forwardMsgs] : [];
      if (!cliente?.id || !msgs.length || forwardJobLockRef.current) return;
      forwardJobLockRef.current = true;

      releaseForwardUi({ destCount: 1, msgCount: msgs.length });

      runForwardInBackground(async () => {
        const n = msgs.length;
        let tempIds = [];
        try {
          const data = await abrirConversaCliente(cliente.id);
          const conv = data?.conversa || data || null;
          const destId = conv?.id || null;
          if (!destId) throw new Error("Não foi possível abrir a conversa do cliente.");
          try {
            useChatStore.getState().addChat(conv);
          } catch (_) {}
          tempIds = applyForwardOptimisticFor(destId, msgs);
          const { stats, assumeError } = await processForwardToDest(destId, msgs, tempIds);
          if (stats?.failures > 0) {
            showToast({
              type: "info",
              title: "Encaminhamento parcial",
              message: `${stats.successes} de ${stats.total} encaminhada(s); ${stats.failures} falha(s).`,
            });
          } else {
            showToast({
              type: "success",
              title: n > 1 ? "Encaminhadas" : "Encaminhada",
              message: n > 1 ? `${n} mensagens encaminhadas.` : "Mensagem encaminhada.",
            });
          }
          if (assumeError) {
            showToast({
              type: "warning",
              title: "Encaminhado, mas não foi possível assumir",
              message: assumeError,
            });
          }
        } catch (e) {
          const errMsg = formatForwardHttpError(e);
          tempIds.forEach((tid) =>
            useConversaStore.getState().marcarMensagemTempErro(tid, { erro_mensagem: errMsg })
          );
          showToast({ type: "error", title: "Falha ao encaminhar", message: errMsg });
        }
      });
    },
    [forwardMsgs, applyForwardOptimisticFor, releaseForwardUi, runForwardInBackground, processForwardToDest, showToast]
  );

  const confirmForwardToColaborador = useCallback(
    (colab) => {
      const targetUserId = colab?.id ?? colab?.user_id ?? colab?.usuario_id;
      const msgs = Array.isArray(forwardMsgs) ? [...forwardMsgs] : [];
      const ids = msgs.map((m) => m.id).filter((id) => id != null);
      const originId = conversaId;
      if (!ids.length || !originId || targetUserId == null || forwardJobLockRef.current) return;
      forwardJobLockRef.current = true;

      releaseForwardUi({ destCount: 1, msgCount: msgs.length });

      runForwardInBackground(async () => {
        try {
          const data = await forwardAtendimentoMessageToColaborador({
            conversaOrigemId: originId,
            mensagemIds: ids,
            targetUserId,
          });
          const many = Array.isArray(data?.messages) ? data.messages : null;
          const one = data?.message;
          const n = many?.length || (one ? 1 : 0);
          showToast({
            type: "success",
            title: n > 1 ? "Encaminhadas" : "Encaminhada",
            message:
              n > 1
                ? `${n} mensagens enviadas para o chat interno do colaborador.`
                : "Mensagem enviada para o chat interno do colaborador.",
          });
        } catch (e) {
          console.error("Erro ao encaminhar (colaborador):", e);
          showToast({
            type: "error",
            title: "Falha ao encaminhar",
            message: e?.response?.data?.error || e?.message || "Não foi possível encaminhar para o colaborador.",
          });
        }
      });
    },
    [forwardMsgs, conversaId, releaseForwardUi, runForwardInBackground, showToast]
  );

  return {
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
    resetForwardFlow,
    openForwardFromSelection,
    toggleForwardConversaSelect,
    execEncaminharFor,
    confirmForwardToCliente,
    confirmForwardTo,
    confirmForwardToColaborador,
    confirmForwardToMany,
  };
}
