import { useCallback, useState } from "react";
import { enviarLocalizacao } from "../conversaService";

/**
 * Compartilhamento de localização na conversa (modal + geolocalização).
 * UI em ShareLocationModal; lógica concentrada neste hook.
 */
export function useShareLocation({ conversaId, showToast, composerRef }) {
  const [shareLocationOpen, setShareLocationOpen] = useState(false);
  const [shareLocationGeoLoading, setShareLocationGeoLoading] = useState(false);
  const [shareLocationGeoError, setShareLocationGeoError] = useState(null);
  const [shareLocationLat, setShareLocationLat] = useState("");
  const [shareLocationLng, setShareLocationLng] = useState("");
  const [shareLocationNome, setShareLocationNome] = useState("");
  const [shareLocationEndereco, setShareLocationEndereco] = useState("");
  const [shareLocationSending, setShareLocationSending] = useState(false);

  const openShareLocation = useCallback(() => {
    composerRef.current?.closePanels?.();
    setShareLocationGeoError(null);
    setShareLocationNome("");
    setShareLocationEndereco("");
    setShareLocationLat("");
    setShareLocationLng("");
    setShareLocationOpen(true);
    setShareLocationGeoLoading(true);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setShareLocationGeoLoading(false);
      setShareLocationGeoError("Geolocalização indisponível neste navegador. Informe latitude e longitude abaixo.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setShareLocationLat(String(pos.coords.latitude));
        setShareLocationLng(String(pos.coords.longitude));
        setShareLocationGeoLoading(false);
      },
      () => {
        setShareLocationGeoLoading(false);
        setShareLocationGeoError(
          "Não foi possível obter sua posição. Permita o acesso à localização ou informe latitude e longitude manualmente."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [composerRef]);

  const handleShareLocationClose = useCallback(() => {
    if (shareLocationSending) return;
    setShareLocationOpen(false);
  }, [shareLocationSending]);

  const handleEnviarLocalizacao = useCallback(async () => {
    if (!conversaId || shareLocationSending) return;
    const la = Number(String(shareLocationLat).replace(",", "."));
    const ln = Number(String(shareLocationLng).replace(",", "."));
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      showToast({
        type: "error",
        title: "Coordenadas inválidas",
        message: "Informe latitude e longitude válidas.",
      });
      return;
    }
    setShareLocationSending(true);
    try {
      await enviarLocalizacao(conversaId, {
        lat: la,
        lng: ln,
        nome: shareLocationNome.trim() || undefined,
        endereco: shareLocationEndereco.trim() || undefined,
      });
      setShareLocationOpen(false);
      setShareLocationGeoError(null);
      showToast({
        type: "success",
        title: "Localização enviada",
        message: "A mensagem aparecerá na conversa quando o servidor confirmar.",
      });
    } catch (err) {
      console.error("Erro ao enviar localização:", err);
      const is403 = err?.response?.status === 403;
      const apiMsg = err?.response?.data?.error;
      showToast({
        type: "error",
        title: is403 ? "Acesso restrito" : "Falha ao enviar localização",
        message:
          apiMsg ||
          (is403 ? "Assuma a conversa antes de enviar mensagens." : "Não foi possível enviar a localização."),
      });
    } finally {
      setShareLocationSending(false);
    }
  }, [
    conversaId,
    shareLocationSending,
    shareLocationLat,
    shareLocationLng,
    shareLocationNome,
    shareLocationEndereco,
    showToast,
  ]);

  return {
    shareLocationOpen,
    setShareLocationOpen,
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
  };
}
