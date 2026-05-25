import { useCallback, useEffect, useState } from "react";
import { enviarContato } from "../conversaService";
import * as cfg from "../../api/configService";
import { safeString } from "../utils/conversaViewHelpers";

/**
 * Compartilhamento de contato/cliente na conversa (modal + busca debounced).
 * UI em ShareContactModal; lógica concentrada neste hook.
 */
export function useShareContact({ conversaId, showToast }) {
  const [shareContactOpen, setShareContactOpen] = useState(false);
  const [shareContactQuery, setShareContactQuery] = useState("");
  const [shareContactList, setShareContactList] = useState([]);
  const [shareContactLoading, setShareContactLoading] = useState(false);
  const [shareContactSending, setShareContactSending] = useState(false);

  useEffect(() => {
    if (!shareContactOpen) {
      setShareContactList([]);
      setShareContactQuery("");
      setShareContactLoading(false);
      return;
    }
    const q = safeString(shareContactQuery).trim().toLowerCase();
    setShareContactLoading(true);
    const t = setTimeout(async () => {
      try {
        const list = await cfg.getClientes({ palavra: q || undefined, limit: 60 });
        const arr = Array.isArray(list) ? list : [];
        setShareContactList(arr);
      } catch (e) {
        console.error("Erro ao buscar contatos:", e);
        setShareContactList([]);
      } finally {
        setShareContactLoading(false);
      }
    }, 260);
    return () => clearTimeout(t);
  }, [shareContactOpen, shareContactQuery]);

  const openShareContact = useCallback(() => {
    setShareContactOpen(true);
  }, []);

  const handleShareContactClose = useCallback(() => {
    if (shareContactSending) return;
    setShareContactOpen(false);
    setShareContactQuery("");
    setShareContactList([]);
  }, [shareContactSending]);

  const handleShareContactSelect = useCallback(
    async (c) => {
      if (!conversaId || shareContactSending) return;
      setShareContactSending(true);
      try {
        await enviarContato(conversaId, c.id);
        setShareContactOpen(false);
        setShareContactQuery("");
        setShareContactList([]);
        showToast({
          type: "success",
          title: "Contato enviado",
          message: "O contato foi compartilhado na conversa.",
        });
      } catch (err) {
        console.error("Erro ao enviar contato:", err);
        const is403 = err?.response?.status === 403;
        const apiMsg = err?.response?.data?.error;
        showToast({
          type: "error",
          title: is403 ? "Acesso restrito" : "Falha ao enviar contato",
          message:
            apiMsg ||
            (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar o contato."),
        });
      } finally {
        setShareContactSending(false);
      }
    },
    [conversaId, shareContactSending, showToast]
  );

  return {
    shareContactOpen,
    setShareContactOpen,
    shareContactQuery,
    setShareContactQuery,
    shareContactList,
    shareContactLoading,
    shareContactSending,
    openShareContact,
    handleShareContactClose,
    handleShareContactSelect,
  };
}
