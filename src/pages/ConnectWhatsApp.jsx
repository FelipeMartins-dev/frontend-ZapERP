import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useNotificationStore } from "../notifications/notificationStore";
import {
  getZapiConnectStatus,
  getZapiConnectQrCode,
  postZapiConnectRestart,
  getZapiOperationalStatus,
} from "../api/zapiIntegration";
import { syncContacts, syncGroups, syncAll } from "../api/whatsappIntegration";
import Breadcrumb from "../components/layout/Breadcrumb";
import "../components/layout/breadcrumb.css";
import "./IA.css";

function ConnectedSyncStatus({ opStatus, onRefresh }) {
  const navigate = useNavigate();
  if (!opStatus) return null;
  const pending = opStatus.syncPending || opStatus.syncStatus === "running";
  return (
    <div style={{ marginTop: 12, padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 13 }}>
      {pending ? (
        <span>Sessão conectada / Sincronização em andamento</span>
      ) : opStatus.lastSyncAt ? (
        <span>Último sync: {new Date(opStatus.lastSyncAt).toLocaleString("pt-BR")}</span>
      ) : (
        <span>Sessão conectada / Sincronização pendente</span>
      )}
      {" — "}
      <button type="button" className="ia-btn ia-btn--outline" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => navigate("/configuracoes?tab=clientes")}>
        Ir para Clientes
      </button>
    </div>
  );
}

function SyncButtons({ showToast, onRefreshOpStatus }) {
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);

  const handleSyncContacts = async () => {
    setLoadingContacts(true);
    try {
      const res = await syncContacts();
      if (res?.ok !== false) {
        const inserted = res?.inserted ?? res?.criados ?? 0;
        const updated = res?.updated ?? res?.atualizados ?? 0;
        showToast?.({
          type: "success",
          title: "Contatos sincronizados",
          message: `${inserted} inseridos, ${updated} atualizados`,
        });
        onRefreshOpStatus?.();
      } else {
        showToast?.({ type: "error", title: "Erro", message: res?.message || "Erro ao sincronizar contatos" });
      }
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      if (status === 404) {
        showToast?.({
          type: "error",
          title: "UltraMsg não configurado",
          message: "Configure o UltraMsg em Integrações para sincronizar contatos.",
        });
      } else if (status === 429) {
        const sec = data?.retryAfterSeconds ?? 60;
        showToast?.({
          type: "warning",
          title: "Muitas requisições",
          message: `Aguarde ${sec} segundos antes de tentar novamente.`,
        });
      } else {
        showToast?.({ type: "error", title: "Erro", message: data?.error || e?.message || "Erro ao sincronizar contatos" });
      }
    } finally {
      setLoadingContacts(false);
    }
  };

  const handleSyncGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await syncGroups();
      if (res?.ok !== false) {
        const inserted = res?.inserted ?? 0;
        const updated = res?.updated ?? 0;
        showToast?.({
          type: "success",
          title: "Grupos sincronizados",
          message: `${inserted} inseridos, ${updated} atualizados`,
        });
        onRefreshOpStatus?.();
      } else {
        showToast?.({ type: "error", title: "Erro", message: res?.message || "Erro ao sincronizar grupos" });
      }
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      if (status === 404) {
        showToast?.({
          type: "error",
          title: "UltraMsg não configurado",
          message: "Configure o UltraMsg em Integrações para sincronizar grupos.",
        });
      } else if (status === 429) {
        const sec = data?.retryAfterSeconds ?? 60;
        showToast?.({
          type: "warning",
          title: "Muitas requisições",
          message: `Aguarde ${sec} segundos antes de tentar novamente.`,
        });
      } else {
        showToast?.({ type: "error", title: "Erro", message: data?.error || e?.message || "Erro ao sincronizar grupos" });
      }
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleSyncAll = async () => {
    setLoadingAll(true);
    try {
      const res = await syncAll();
      if (res?.ok !== false) {
        const contacts = res?.contacts ?? {};
        const groups = res?.groups ?? {};
        const chats = res?.chats ?? {};
        const msg = [
          `Contatos: ${contacts.inserted ?? 0} novos, ${contacts.updated ?? 0} atualizados`,
          `Grupos: ${groups.inserted ?? 0} novos, ${groups.updated ?? 0} atualizados`,
          `Chats: ${chats.inserted ?? 0} novos, ${chats.updated ?? 0} atualizados`,
        ].join(" | ");
        showToast?.({ type: "success", title: "Sincronização concluída", message: msg });
        onRefreshOpStatus?.();
      } else {
        showToast?.({ type: "error", title: "Erro", message: res?.message || "Erro ao sincronizar" });
      }
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;
      if (status === 404) {
        showToast?.({
          type: "error",
          title: "UltraMsg não configurado",
          message: "Configure o UltraMsg em Integrações para sincronizar.",
        });
      } else if (status === 429) {
        const sec = data?.retryAfterSeconds ?? 60;
        showToast?.({
          type: "warning",
          title: "Muitas requisições",
          message: `Aguarde ${sec} segundos antes de tentar novamente.`,
        });
      } else {
        showToast?.({ type: "error", title: "Erro", message: data?.error || e?.message || "Erro ao sincronizar" });
      }
    } finally {
      setLoadingAll(false);
    }
  };

  const anyLoading = loadingContacts || loadingGroups || loadingAll;

  return (
    <div className="zapi-sync-section" style={{ marginTop: 20, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
      <h4 style={{ margin: "0 0 12px 0", fontSize: 15 }}>Sincronização</h4>
      <p className="ia-muted" style={{ margin: "0 0 12px 0", fontSize: 13 }}>
        Atualize contatos, grupos e chats a partir do celular conectado.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          type="button"
          className="ia-btn ia-btn--outline"
          disabled={anyLoading}
          onClick={handleSyncContacts}
        >
          {loadingContacts ? "Sincronizando…" : "Sincronizar contatos"}
        </button>
        <button
          type="button"
          className="ia-btn ia-btn--outline"
          disabled={anyLoading}
          onClick={handleSyncGroups}
        >
          {loadingGroups ? "Sincronizando…" : "Sincronizar grupos"}
        </button>
        <button
          type="button"
          className="ia-btn ia-btn--primary"
          disabled={anyLoading}
          onClick={handleSyncAll}
        >
          {loadingAll ? "Sincronizando…" : "Sincronizar tudo"}
        </button>
      </div>
    </div>
  );
}

function getStatusBadge(status) {
  if (!status) return { label: "Verificando…", tone: "muted", icon: "⏳" };
  if (status.connected) return { label: "Conectado", tone: "success", icon: "✅" };
  if (!status.smartphoneConnected) return { label: "Celular sem internet", tone: "warning", icon: "📶" };
  return { label: "Desconectado", tone: "danger", icon: "⚠️" };
}

export default function ConnectWhatsApp() {
  const navigate = useNavigate();
  const showToast = useNotificationStore((s) => s.showToast);

  const [status, setStatus] = useState(null);
  const [qrSrc, setQrSrc] = useState(null);
  const [attemptsLeft, setAttemptsLeft] = useState(null);
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(15);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingQr, setLoadingQr] = useState(false);
  const [loadingRestart, setLoadingRestart] = useState(false);
  const [error, setError] = useState(null);
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [throttleState, setThrottleState] = useState(null); // { retryAfterSeconds, attemptsLeft, reason }
  const [retryCountdown, setRetryCountdown] = useState(null);
  const [lastQrUpdate, setLastQrUpdate] = useState(null);
  const [isPolling, setIsPolling] = useState(false);
  const [opStatus, setOpStatus] = useState(null);

  const qrPollRef = useRef(null);
  const countdownRef = useRef(null);
  const isMountedRef = useRef(false);

  const clearQrPoll = useCallback(() => {
    if (qrPollRef.current) {
      clearInterval(qrPollRef.current);
      qrPollRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const clearCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setRetryCountdown(null);
  }, []);

  const clearAllTimers = useCallback(() => {
    clearQrPoll();
    clearCountdown();
  }, [clearQrPoll, clearCountdown]);

  const fetchStatus = useCallback(
    async (options = {}) => {
      const { silent = false } = options;
      if (!silent) setLoadingStatus(true);
      try {
        const data = await getZapiConnectStatus();
        if (!isMountedRef.current) return null;
        setStatus(data);
        setError(data?.error || null);
        return data;
      } catch (err) {
        if (!isMountedRef.current) return null;
        const msg = err?.response?.data?.error || "Erro ao consultar status.";
        setError(msg);
        if (err?.response?.status === 401) return null;
        showToast?.({ type: "error", title: "Erro", message: msg });
        return null;
      } finally {
        if (!silent && isMountedRef.current) setLoadingStatus(false);
      }
    },
    [showToast]
  );

  const fetchQrCode = useCallback(
    async (options = {}) => {
      const { silent = false } = options;
      if (!silent) setLoadingQr(true);
      try {
        const { status: resStatus, data } = await getZapiConnectQrCode();
        if (!isMountedRef.current) return { done: true, restartPoll: false };

        if (resStatus === 401) return { done: true, restartPoll: false };

        if (resStatus === 200 && data.connected === true) {
          clearAllTimers();
          setQrSrc(null);
          setThrottleState(null);
          await fetchStatus({ silent: true });
          return { done: true, restartPoll: false };
        }

        if (resStatus === 409 && data.needsRestore) {
          clearAllTimers();
          setQrSrc(null);
          setThrottleState(null);
          setStatus((s) => (s ? { ...s, needsRestore: true } : { needsRestore: true }));
          return { done: true, restartPoll: false };
        }

        if (resStatus === 429) {
          clearQrPoll();
          const retrySec = data.retryAfterSeconds ?? 60;
          setThrottleState({
            retryAfterSeconds: retrySec,
            attemptsLeft: data.attemptsLeft ?? 0,
            reason: data.error || "throttled",
          });
          setRetryCountdown(retrySec);
          return { done: true, restartPoll: false };
        }

        if (resStatus === 200 && data.qrBase64 && String(data.qrBase64).trim().length > 0) {
          const sec = data.nextRefreshSeconds ?? 15;
          const clamped = Math.max(10, Math.min(20, sec));
          setQrSrc(`data:image/png;base64,${data.qrBase64}`);
          setAttemptsLeft(data.attemptsLeft ?? null);
          setPollIntervalSeconds(clamped);
          setLastQrUpdate(Date.now());
          setThrottleState(null);
          return {
            done: false,
            restartPoll: true,
            nextRefreshSeconds: clamped,
          };
        }

        if (resStatus === 200 && data.connected === false && !data.qrBase64) {
          setError("QR Code não disponível. Tente novamente em instantes.");
          return { done: true, restartPoll: false };
        }

        setError("Resposta inesperada ao gerar QR Code.");
        return { done: true, restartPoll: false };
      } catch (err) {
        if (!isMountedRef.current) return { done: true, restartPoll: false };
        setError(err?.response?.data?.error || "Erro ao gerar QR Code.");
        showToast?.({ type: "error", title: "Erro", message: "Falha ao obter QR Code." });
        return { done: true, restartPoll: false };
      } finally {
        if (!silent && isMountedRef.current) setLoadingQr(false);
      }
    },
    [fetchStatus, clearQrPoll, clearAllTimers, showToast]
  );

  const startQrPolling = useCallback(
    (intervalSeconds) => {
      clearQrPoll();
      const sec = Math.max(10, Math.min(20, intervalSeconds || 15)) * 1000;
      qrPollRef.current = setInterval(async () => {
        if (!isMountedRef.current) return;
        const result = await fetchQrCode({ silent: true });
        if (!isMountedRef.current) return;
        if (result?.done) return;
        if (result?.restartPoll && result?.nextRefreshSeconds) {
          clearQrPoll();
          startQrPolling(result.nextRefreshSeconds);
        }
      }, sec);
      setIsPolling(true);
    },
    [clearQrPoll, fetchQrCode]
  );

  const bootstrap = useCallback(async () => {
    if (!isMountedRef.current) return;
    clearAllTimers();
    setQrSrc(null);
    setThrottleState(null);
    setError(null);
    const st = await fetchStatus();
    if (!isMountedRef.current || !st) return;
    if (!st.hasInstance || st.needsRestore || st.connected) return;
    const result = await fetchQrCode();
    if (!isMountedRef.current) return;
    if (result?.restartPoll && result?.nextRefreshSeconds) {
      startQrPolling(result.nextRefreshSeconds);
    }
  }, [fetchStatus, fetchQrCode, startQrPolling, clearAllTimers]);

  useEffect(() => {
    isMountedRef.current = true;
    bootstrap();
    return () => {
      isMountedRef.current = false;
      clearAllTimers();
    };
  }, []);

  useEffect(() => {
    if (retryCountdown == null || retryCountdown <= 0) return;
    const id = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev == null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    countdownRef.current = id;
    return () => {
      clearInterval(id);
      countdownRef.current = null;
    };
  }, [retryCountdown]);

  const handleGenerateQr = async () => {
    if (throttleState != null && (retryCountdown == null || retryCountdown > 0)) return;
    clearAllTimers();
    setThrottleState(null);
    setQrSrc(null);
    setError(null);
    const st = await fetchStatus();
    if (!isMountedRef.current || !st) return;
    if (st.connected || !st.hasInstance || st.needsRestore) return;
    const result = await fetchQrCode();
    if (!isMountedRef.current) return;
    if (result?.restartPoll && result?.nextRefreshSeconds) {
      startQrPolling(result.nextRefreshSeconds);
    }
  };

  const handleTryAgainAfterThrottle = () => {
    if (throttleState == null || (retryCountdown != null && retryCountdown > 0)) return;
    setThrottleState(null);
    setRetryCountdown(null);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    handleGenerateQr();
  };

  const handleRestart = async () => {
    setLoadingRestart(true);
    try {
      const data = await postZapiConnectRestart();
      if (!isMountedRef.current) return;
      if (data) setStatus(data);
      showToast?.({
        type: "success",
        title: "Instância reiniciada",
        message: "Recarregando status…",
      });
      const fresh = await fetchStatus({ silent: true });
      if (isMountedRef.current && fresh) {
        setStatus(fresh);
        if (!fresh.needsRestore && !fresh.connected && fresh.hasInstance) {
          clearAllTimers();
          setThrottleState(null);
          setQrSrc(null);
        }
      }
    } catch (err) {
      showToast?.({
        type: "error",
        title: "Falha ao reiniciar",
        message: err?.response?.data?.error || "Não foi possível reiniciar.",
      });
    } finally {
      setLoadingRestart(false);
      setShowRestartModal(false);
    }
  };

  const badge = getStatusBadge(status);
  const hasInstance = status?.hasInstance !== false;
  const needsRestore = status?.needsRestore === true;
  const connected = status?.connected === true;
  const meSummary = status?.meSummary;
  const canRetry = throttleState != null && retryCountdown !== null && retryCountdown <= 0;

  useEffect(() => {
    if (connected) {
      getZapiOperationalStatus().then((d) => { if (isMountedRef.current) setOpStatus(d); });
    } else {
      setOpStatus(null);
    }
  }, [connected]);

  const hasValidQr = qrSrc && qrSrc.startsWith("data:image/png;base64,") && qrSrc.length > 30;

  return (
    <div className="ia-wrap">
      <header className="ia-header">
        <Breadcrumb items={[{ label: "Configurações", to: "/configuracoes" }, { label: "Conectar WhatsApp" }]} />
        <h1 className="ia-title">Conectar WhatsApp</h1>
        <p className="ia-subtitle">
          Conecte a instância UltraMSG da sua empresa via QR Code, como no WhatsApp Web.
        </p>
      </header>

      <div className="ia-content">
        <div className="zapi-card">
          <div className="zapi-card-head">
            <div>
              <h2 className="zapi-card-title">Conectar WhatsApp</h2>
              <p className="zapi-card-sub">
                Leia o QR Code com o aplicativo WhatsApp no seu celular para conectar esta instância.
              </p>
            </div>
            <div className={`zapi-statusBadge zapi-statusBadge--${badge.tone}`}>
              <span className="zapi-statusBadge-icon">{badge.icon}</span>
              <span>{badge.label}</span>
            </div>
          </div>

          {loadingStatus && !status ? (
            <div className="zapi-empty">
              <p>Carregando status…</p>
            </div>
          ) : !hasInstance ? (
            <div className="zapi-empty">
              <h3>Sua empresa ainda não tem instância configurada</h3>
              <p>Contate o suporte para configurar a instância UltraMSG da sua empresa.</p>
            </div>
          ) : needsRestore ? (
            <div className="zapi-empty">
              <h3>Instância precisa ser reiniciada</h3>
              <p>A instância UltraMSG precisa ser reiniciada antes de gerar um novo QR Code.</p>
              <button
                type="button"
                className="ia-btn ia-btn--primary"
                onClick={() => setShowRestartModal(true)}
                disabled={loadingRestart}
              >
                {loadingRestart ? "Reiniciando…" : "Reiniciar instância"}
              </button>
            </div>
          ) : connected ? (
            <div className="zapi-main">
              <div className="zapi-qrColumn">
                <div className="zapi-connectedState">
                  <div className="zapi-connectedEmoji">✅</div>
                  <h3>WhatsApp conectado</h3>
                  <p className="ia-muted">
                    {status?.smartphoneConnected
                      ? "Sua instância está conectada e o celular está online."
                      : "O celular pode estar sem internet. A conexão será restabelecida automaticamente."}
                  </p>
                  <ConnectedSyncStatus
                    opStatus={opStatus}
                    onRefresh={() => getZapiOperationalStatus().then((d) => { if (isMountedRef.current) setOpStatus(d); })}
                  />
                  <SyncButtons
                    showToast={showToast}
                    onRefreshOpStatus={() => getZapiOperationalStatus().then((d) => { if (isMountedRef.current) setOpStatus(d); })}
                  />
                </div>
              </div>
              <div className="zapi-instructions">
                <h3>Dados da conexão</h3>
                {meSummary && (
                  <div className="zapi-me">
                    <div className="zapi-me-info">
                      <div className="zapi-me-name">{meSummary.name || "WhatsApp conectado"}</div>
                      {meSummary.phone && (
                        <div className="zapi-me-phone ia-muted">{meSummary.phone}</div>
                      )}
                      {meSummary.paymentStatus != null && (
                        <div className="ia-muted">Status de pagamento: {meSummary.paymentStatus}</div>
                      )}
                      {meSummary.due != null && (
                        <div className="ia-muted">Vencimento: {new Date(meSummary.due).toLocaleDateString()}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="zapi-main">
                <div className="zapi-qrColumn">
                  <div className="zapi-qrBox">
                    {loadingQr && !qrSrc ? (
                      <div className="zapi-qrPlaceholder">Gerando QR Code…</div>
                    ) : throttleState ? (
                      <div className="zapi-qrPlaceholder">
                        <p>
                          {throttleState.reason === "blocked"
                            ? "Muitas tentativas. Aguarde antes de tentar novamente."
                            : "Aguarde antes de solicitar outro QR Code."}
                        </p>
                        {retryCountdown != null && retryCountdown > 0 && (
                          <p className="zapi-paused">
                            Pode tentar novamente em <strong>{Math.max(0, retryCountdown)}s</strong>
                          </p>
                        )}
                      </div>
                    ) : hasValidQr ? (
                      <img
                        src={qrSrc}
                        alt="QR Code para conectar o WhatsApp"
                        className="zapi-qrImage"
                      />
                    ) : qrSrc ? (
                      <div className="zapi-qrPlaceholder">
                        QR Code inválido. Clique em &ldquo;Gerar QR Code&rdquo; para tentar novamente.
                      </div>
                    ) : (
                      <div className="zapi-qrPlaceholder">
                        Clique em &ldquo;Gerar QR Code&rdquo; para iniciar.
                      </div>
                    )}
                  </div>
                  <p className="ia-muted zapi-qrHint">
                    O QR Code expira rapidamente. Se não funcionar, gere um novo.
                  </p>
                  {isPolling && hasValidQr && (
                    <p className="ia-muted zapi-qrRefreshHint">
                      Atualizando QR a cada {pollIntervalSeconds}s
                      {lastQrUpdate && (
                        <> · Última atualização há {Math.round((Date.now() - lastQrUpdate) / 1000)}s</>
                      )}
                    </p>
                  )}
                  {attemptsLeft != null && attemptsLeft <= 0 && !throttleState && (
                    <p className="zapi-paused">
                      Clique em <strong>Gerar QR Code</strong> para tentar novamente.
                    </p>
                  )}
                </div>

                <div className="zapi-instructions">
                  <h3>Como conectar</h3>
                  <ol>
                    <li>Abra o WhatsApp no seu celular.</li>
                    <li>Toque em <strong>Dispositivos conectados</strong>.</li>
                    <li>Escolha <strong>Conectar dispositivo</strong>.</li>
                    <li>Aponte a câmera para este QR Code.</li>
                  </ol>
                  <p className="ia-muted">
                    O status será atualizado automaticamente quando conectar.
                  </p>
                </div>
              </div>

              {error && (
                <div className="ia-error-banner" role="alert" style={{ marginTop: 16 }}>
                  {error}
                  <button type="button" onClick={() => setError(null)} aria-label="Fechar">
                    ×
                  </button>
                </div>
              )}

              <div className="ia-btn-row zapi-actions">
                <button
                  type="button"
                  className="ia-btn ia-btn--outline"
                  onClick={() => navigate("/configuracoes?tab=geral")}
                >
                  Voltar para Configurações
                </button>
                {throttleState ? (
                  <button
                    type="button"
                    className="ia-btn ia-btn--primary"
                    onClick={handleTryAgainAfterThrottle}
                    disabled={!canRetry}
                  >
                    Tentar novamente
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ia-btn ia-btn--primary"
                    onClick={handleGenerateQr}
                    disabled={loadingStatus || loadingQr}
                  >
                    {loadingQr && !qrSrc ? "Gerando…" : "Gerar QR Code"}
                  </button>
                )}
                <button
                  type="button"
                  className="ia-btn ia-btn--outline"
                  onClick={() => setShowRestartModal(true)}
                  disabled={loadingRestart}
                >
                  Reiniciar instância
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {showRestartModal && (
        <div
          className="wa-modalOverlay"
          role="dialog"
          aria-label="Reiniciar instância do WhatsApp"
          onMouseDown={() => {
            if (loadingRestart) return;
            setShowRestartModal(false);
          }}
        >
          <div className="wa-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="wa-modal-head">
              <div className="wa-modal-title">Reiniciar instância</div>
              <button
                type="button"
                className="wa-header-btn"
                onClick={() => !loadingRestart && setShowRestartModal(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="wa-modal-body">
              <p style={{ marginBottom: 12 }}>
                Tem certeza que deseja reiniciar a instância UltraMSG desta empresa?
              </p>
              <p className="ia-muted" style={{ marginBottom: 0 }}>
                As conexões ativas podem cair por alguns instantes. Um novo QR Code poderá ser
                necessário.
              </p>
            </div>
            <div className="wa-modal-body" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                className="ia-btn ia-btn--outline"
                onClick={() => !loadingRestart && setShowRestartModal(false)}
                disabled={loadingRestart}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="ia-btn ia-btn--primary"
                onClick={handleRestart}
                disabled={loadingRestart}
              >
                {loadingRestart ? "Reiniciando…" : "Confirmar reinício"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
