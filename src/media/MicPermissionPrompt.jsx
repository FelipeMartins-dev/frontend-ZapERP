import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  acquireMicStream,
  hasStoredMicGrant,
  isMicSupported,
  markMicPermissionGranted,
  queryMicPermissionState,
  warmMicStreamSilently,
} from "./micStreamService";
import "../push/push-permission-prompt.css";

const STORAGE_DISMISS_UNTIL = "zaperp_mic_optin_dismissed_until";
const SESSION_DENIED_HINT = "zaperp_mic_denied_hint_shown_v1";
const DISMISS_DAYS = 30;

const MIC_ROUTES = ["/atendimento", "/chat-interno"];

function dismissUntilMs() {
  return Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function isMobileCoarsePointer() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)")?.matches === true;
}

function routeNeedsMic(pathname) {
  return MIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export default function MicPermissionPrompt() {
  const { pathname } = useLocation();
  const [ui, setUi] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!isMicSupported()) {
        if (!cancelled) setUi("none");
        return;
      }

      if (!routeNeedsMic(pathname) || !isMobileCoarsePointer()) {
        if (!cancelled) setUi("none");
        return;
      }

      const perm = await queryMicPermissionState();
      if (cancelled) return;

      if (perm === "granted" || hasStoredMicGrant()) {
        void warmMicStreamSilently().catch(() => {});
        setUi("none");
        return;
      }

      if (perm === "denied") {
        try {
          if (sessionStorage.getItem(SESSION_DENIED_HINT) === "1") {
            setUi("none");
            return;
          }
        } catch {
          /* ignore */
        }
        setUi("denied_strip");
        return;
      }

      try {
        const raw = localStorage.getItem(STORAGE_DISMISS_UNTIL);
        const until = raw ? Number(raw) : 0;
        if (until > Date.now()) {
          setUi("none");
          return;
        }
      } catch {
        /* ignore */
      }

      setUi("modal");
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function handleEnable() {
    setBusy(true);
    try {
      await acquireMicStream();
      markMicPermissionGranted();
      setUi("none");
    } catch {
      const perm = await queryMicPermissionState();
      if (perm === "denied") {
        setUi("denied_strip");
      }
    } finally {
      setBusy(false);
    }
  }

  function handleDismiss() {
    try {
      localStorage.setItem(STORAGE_DISMISS_UNTIL, String(dismissUntilMs()));
    } catch {
      /* ignore */
    }
    setUi("none");
  }

  function dismissDeniedHint() {
    try {
      sessionStorage.setItem(SESSION_DENIED_HINT, "1");
    } catch {
      /* ignore */
    }
    setUi("none");
  }

  if (ui === null || ui === "none") return null;

  if (ui === "modal") {
    return (
      <div className="zap-push-overlay" role="dialog" aria-modal="true" aria-labelledby="zap-mic-modal-title">
        <div className="zap-push-modal">
          <div className="zap-push-modal__brand" aria-hidden="true">
            <span className="zap-push-modal__dot" />
          </div>
          <h2 id="zap-mic-modal-title" className="zap-push-modal__title">
            Microfone
          </h2>
          <p className="zap-push-modal__text">
            Ative o microfone uma única vez para gravar áudios nas conversas. Toque em <strong>Permitir</strong> na
            próxima tela — no iPhone, evite &quot;Apenas desta vez&quot; para não precisar autorizar de novo.
          </p>
          <div className="zap-push-modal__actions">
            <button type="button" className="zap-push-btn zap-push-btn--secondary" disabled={busy} onClick={handleDismiss}>
              Agora não
            </button>
            <button type="button" className="zap-push-btn zap-push-btn--primary" disabled={busy} onClick={handleEnable}>
              {busy ? "Abrindo…" : "Ativar microfone"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (ui === "denied_strip") {
    return (
      <div className="zap-push-strip" role="status">
        <p className="zap-push-strip__text">
          Microfone bloqueado neste navegador. Para gravar áudios sem pedir toda hora, permita o microfone nas
          configurações do site (ícone de cadeado na barra de endereço).
        </p>
        <button type="button" className="zap-push-strip__close" onClick={dismissDeniedHint} aria-label="Fechar aviso">
          ×
        </button>
      </div>
    );
  }

  return null;
}
