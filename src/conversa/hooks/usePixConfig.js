import { useCallback, useState } from "react";
import { getPixConfig, putPixConfig } from "../conversaService";
import { safeString } from "../utils/conversaViewHelpers";

/**
 * Configuração e envio de mensagem Pix (modal + composer).
 * UI em PixConfigModal; lógica concentrada neste hook.
 */
export function usePixConfig({
  conversaId,
  sending,
  podeEnviar,
  showToast,
  handleEnviar,
  composerRef,
}) {
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [pixConfigLoading, setPixConfigLoading] = useState(false);
  const [pixConfigLoaded, setPixConfigLoaded] = useState(false);
  const [pixConfigSaving, setPixConfigSaving] = useState(false);
  const [pixActionBusy, setPixActionBusy] = useState(false);
  const [pixTipoChave, setPixTipoChave] = useState("cpf");
  const [pixChave, setPixChave] = useState("");
  const [pixNomeRecebedor, setPixNomeRecebedor] = useState("");
  const [pixMensagemPadrao, setPixMensagemPadrao] = useState("");

  const isPixConfigured = useCallback((cfgData) => {
    if (!cfgData || typeof cfgData !== "object") return false;
    const tipo = safeString(cfgData.tipo_chave).toLowerCase();
    const chave = safeString(cfgData.chave_pix);
    const nome = safeString(cfgData.nome_recebedor);
    return !!tipo && !!chave && !!nome;
  }, []);

  const applyPixConfigToForm = useCallback((cfgData) => {
    const next = cfgData && typeof cfgData === "object" ? cfgData : {};
    setPixTipoChave(safeString(next.tipo_chave).toLowerCase() || "cpf");
    setPixChave(safeString(next.chave_pix));
    setPixNomeRecebedor(safeString(next.nome_recebedor));
    setPixMensagemPadrao(safeString(next.mensagem_padrao));
  }, []);

  const fetchPixConfigIfNeeded = useCallback(async () => {
    if (pixConfigLoading) return null;
    setPixConfigLoading(true);
    try {
      const payload = await getPixConfig();
      const config = payload?.config && typeof payload.config === "object" ? payload.config : null;
      if (config) applyPixConfigToForm(config);
      setPixConfigLoaded(true);
      return config;
    } catch (err) {
      console.error("Erro ao carregar Pix:", err);
      showToast({
        type: "error",
        title: "Pix",
        message: "Não foi possível carregar a configuração Pix da empresa.",
      });
      return null;
    } finally {
      setPixConfigLoading(false);
    }
  }, [pixConfigLoading, applyPixConfigToForm, showToast]);

  const buildPixMessagePreview = useCallback((cfgData) => {
    const tipoRaw = safeString(cfgData?.tipo_chave).toLowerCase();
    const tipoLabel =
      tipoRaw === "cpf"
        ? "CPF"
        : tipoRaw === "cnpj"
          ? "CNPJ"
          : tipoRaw === "email"
            ? "E-mail"
            : tipoRaw === "telefone"
              ? "Telefone"
              : "Chave aleatória";
    const extra = safeString(cfgData?.mensagem_padrao);
    const lines = [
      "Segue a chave Pix para pagamento:",
      "",
      `Nome: ${safeString(cfgData?.nome_recebedor)}`,
      `Tipo da chave: ${tipoLabel}`,
      `Chave Pix: ${safeString(cfgData?.chave_pix)}`,
    ];
    if (extra) lines.push("", extra);
    lines.push("", "Após o pagamento, por favor envie o comprovante por aqui.");
    return lines.join("\n").trim();
  }, []);

  const handleSalvarPixConfig = useCallback(
    async (opts = {}) => {
      if (pixConfigSaving) return false;
      const payload = {
        tipo_chave: safeString(pixTipoChave).toLowerCase(),
        chave_pix: safeString(pixChave),
        nome_recebedor: safeString(pixNomeRecebedor),
        mensagem_padrao: safeString(pixMensagemPadrao) || null,
      };
      if (!payload.chave_pix || !payload.nome_recebedor) {
        showToast({
          type: "warning",
          title: "Pix",
          message: "Preencha tipo, chave e nome do recebedor.",
        });
        return false;
      }
      setPixConfigSaving(true);
      try {
        const data = await putPixConfig(payload);
        const saved = data?.config || payload;
        applyPixConfigToForm(saved);
        setPixConfigLoaded(true);
        showToast({
          type: "success",
          title: "Pix configurado",
          message: "Os dados Pix foram salvos com sucesso.",
        });
        if (opts?.closeModal !== false) setPixModalOpen(false);
        return true;
      } catch (err) {
        console.error("Erro ao salvar Pix:", err);
        showToast({
          type: "error",
          title: "Pix",
          message: err?.response?.data?.error || "Não foi possível salvar os dados Pix.",
        });
        return false;
      } finally {
        setPixConfigSaving(false);
      }
    },
    [
      pixConfigSaving,
      pixTipoChave,
      pixChave,
      pixNomeRecebedor,
      pixMensagemPadrao,
      applyPixConfigToForm,
      showToast,
    ]
  );

  const handlePixMenuClick = useCallback(async () => {
    if (!conversaId || sending || pixActionBusy || !podeEnviar) return;
    composerRef.current?.closePanels?.();
    setPixActionBusy(true);
    try {
      const localCfg = {
        tipo_chave: pixTipoChave,
        chave_pix: pixChave,
        nome_recebedor: pixNomeRecebedor,
        mensagem_padrao: pixMensagemPadrao,
      };
      let cfgToUse = isPixConfigured(localCfg) ? localCfg : null;
      if (!cfgToUse || !pixConfigLoaded) {
        const fetched = await fetchPixConfigIfNeeded();
        if (fetched && isPixConfigured(fetched)) cfgToUse = fetched;
      }
      if (!cfgToUse || !isPixConfigured(cfgToUse)) {
        setPixModalOpen(true);
        return;
      }
      const msg = buildPixMessagePreview(cfgToUse);
      await handleEnviar(msg);
    } finally {
      setPixActionBusy(false);
    }
  }, [
    conversaId,
    sending,
    pixActionBusy,
    podeEnviar,
    composerRef,
    pixTipoChave,
    pixChave,
    pixNomeRecebedor,
    pixMensagemPadrao,
    isPixConfigured,
    pixConfigLoaded,
    fetchPixConfigIfNeeded,
    buildPixMessagePreview,
    handleEnviar,
  ]);

  return {
    pixModalOpen,
    setPixModalOpen,
    pixConfigLoading,
    pixConfigLoaded,
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
  };
}
