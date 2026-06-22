import { lazy, memo, Suspense, useEffect, useLayoutEffect } from "react";
import {
  isImageFile,
  isVideoFile,
  isAudioFile,
  isEditableImageForSend,
} from "../utils/conversaViewHelpers";
import { IconSend, IconClose } from "../conversaViewIcons";

const ImageSendPreviewMobile = lazy(() => import("../ImageSendPreviewMobile.jsx"));

/** Preview estático enquanto o chunk do editor mobile (crop) carrega. */
function ImageSendPreviewMobileFallback({ imageUrl }) {
  if (!imageUrl) return null;
  return (
    <div
      className="wa-mediaPreview wa-mediaPreview--imageUnified"
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-label="Carregando editor de foto"
    >
      <div className="wa-mediaPreview-stage wa-mediaPreview-stage--crop">
        <div className="wa-imageSend-canvas">
          <img src={imageUrl} alt="" className="wa-imageSend-photo" draggable={false} />
        </div>
      </div>
    </div>
  );
}

/**
 * Preview de mídia/arquivo antes do envio (mobile unificado + overlay desktop).
 * Estados de pending e handlers de envio permanecem no ConversaView.
 */
function PendingMediaPreview({
  pendingFile,
  pendingPreview,
  pendingCaption,
  onCaptionChange,
  sending,
  headerCompact,
  rootRef,
  captionRef,
  onCancel,
  onConfirmSendFile,
  onConfirmSendImageMobile,
}) {
  const useUnifiedImageSendPreview =
    headerCompact &&
    pendingFile &&
    pendingPreview &&
    isEditableImageForSend(pendingFile);

  // Auto-grow do textarea de legenda (preview de mídia, estilo WhatsApp).
  useLayoutEffect(() => {
    const el = captionRef?.current;
    if (!el) return;
    el.style.height = "auto";
    const maxPx = parseFloat(getComputedStyle(el).maxHeight);
    const cap = Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 120;
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [pendingCaption, pendingFile, captionRef]);

  // Foco automático no campo de legenda quando o preview abre — só no desktop
  // (no touch evitamos abrir o teclado de imediato).
  useEffect(() => {
    if (!pendingFile) return;
    if (typeof window === "undefined") return;
    const isCoarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (isCoarse) return;
    const t = setTimeout(() => {
      captionRef?.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [pendingFile, captionRef]);

  /* Preview de envio: inset do teclado (iOS) + foco preso com Tab dentro do diálogo. */
  useEffect(() => {
    if (!pendingFile) return undefined;
    const root = rootRef?.current;
    if (!root) return undefined;

    const previousActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const selector =
      'button:not([disabled]), textarea:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const getFocusable = () =>
      Array.from(root.querySelectorAll(selector)).filter(
        (el) => el instanceof HTMLElement && root.contains(el) && !el.hasAttribute("disabled")
      );

    const raf = requestAnimationFrame(() => {
      const nodes = getFocusable();
      if (nodes.length) nodes[0].focus?.();
    });

    const onTrapKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const nodes = getFocusable();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTrapKeyDown, true);

    const syncKbInset = () => {
      const captionEl = captionRef?.current;
      const captionFocused =
        captionEl instanceof HTMLElement && document.activeElement === captionEl;
      if (!captionFocused) {
        root.style.setProperty("--wa-media-preview-kb-inset", "0px");
        return;
      }
      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty("--wa-media-preview-kb-inset", "0px");
        return;
      }
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--wa-media-preview-kb-inset", `${Math.round(inset)}px`);
    };
    syncKbInset();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncKbInset);
    vv?.addEventListener("scroll", syncKbInset);
    const onCaptionFocusChange = () => syncKbInset();
    document.addEventListener("focusin", onCaptionFocusChange, true);
    document.addEventListener("focusout", onCaptionFocusChange, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onTrapKeyDown, true);
      vv?.removeEventListener("resize", syncKbInset);
      vv?.removeEventListener("scroll", syncKbInset);
      document.removeEventListener("focusin", onCaptionFocusChange, true);
      document.removeEventListener("focusout", onCaptionFocusChange, true);
      root.style.removeProperty("--wa-media-preview-kb-inset");
      if (previousActive && typeof previousActive.focus === "function") {
        try {
          previousActive.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [pendingFile, rootRef, captionRef]);

  if (!pendingFile) return null;

  if (useUnifiedImageSendPreview) {
    return (
      <Suspense fallback={<ImageSendPreviewMobileFallback imageUrl={pendingPreview} />}>
        <ImageSendPreviewMobile
          rootRef={rootRef}
          captionRef={captionRef}
          imageUrl={pendingPreview}
          fileName={pendingFile.name}
          mimeType={pendingFile.type}
          caption={pendingCaption}
          onCaptionChange={onCaptionChange}
          sending={sending}
          onCancel={onCancel}
          onSend={onConfirmSendImageMobile}
          sendIcon={<IconSend />}
        />
      </Suspense>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`wa-mediaPreview${isImageFile(pendingFile) || isVideoFile(pendingFile) ? "" : " wa-mediaPreview--file"}`}
      role="dialog"
      aria-modal="true"
      aria-label={
        isVideoFile(pendingFile)
          ? "Pré-visualizar vídeo antes de enviar"
          : isImageFile(pendingFile)
            ? "Pré-visualizar imagem antes de enviar"
            : isAudioFile(pendingFile)
              ? "Revisar áudio antes de enviar"
              : "Revisar arquivo antes de enviar"
      }
      onKeyDown={(e) => {
        if (e.key === "Escape" && !sending) {
          e.stopPropagation();
          onCancel?.();
        }
      }}
    >
      <div className="wa-mediaPreview-head">
        <button
          type="button"
          className="wa-mediaPreview-close"
          onClick={onCancel}
          disabled={sending}
          aria-label="Cancelar envio"
          title="Cancelar"
        >
          <IconClose />
        </button>
        <span className="wa-mediaPreview-title">
          {isVideoFile(pendingFile)
            ? "Enviar vídeo"
            : isImageFile(pendingFile)
              ? "Enviar foto"
              : isAudioFile(pendingFile)
                ? "Enviar áudio"
                : "Enviar arquivo"}
        </span>
        <span className="wa-mediaPreview-spacer" aria-hidden="true" />
      </div>

      <div className="wa-mediaPreview-stage">
        {isVideoFile(pendingFile) ? (
          <video
            src={pendingPreview}
            className="wa-mediaPreview-media"
            controls
            playsInline
            preload="metadata"
          />
        ) : isImageFile(pendingFile) ? (
          <img
            src={pendingPreview}
            alt="Pré-visualização da imagem a enviar"
            className="wa-mediaPreview-media"
          />
        ) : (
          <div className="wa-fileSendPreview-card">
            <div className="wa-fileSendPreview-icon" aria-hidden="true">
              {isAudioFile(pendingFile) ? "🎧" : "📎"}
            </div>
            <div className="wa-fileSendPreview-meta">
              <div className="wa-fileSendPreview-name">{pendingFile.name}</div>
              <div className="wa-fileSendPreview-sub">
                {isAudioFile(pendingFile) ? "Áudio pronto para envio" : "Arquivo pronto para envio"}
                <span className="wa-dotSep">•</span>
                {(pendingFile.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="wa-mediaPreview-composer">
        <div className="wa-mediaPreview-inputWrap">
          <textarea
            ref={captionRef}
            value={pendingCaption}
            onChange={(e) => onCaptionChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sending) onConfirmSendFile?.();
              }
            }}
            placeholder="Adicionar legenda (opcional)…"
            rows={1}
            className="wa-mediaPreview-input"
            disabled={sending}
            aria-label="Legenda ou comentário junto ao envio"
            enterKeyHint="send"
            maxLength={1024}
          />
        </div>
        <button
          type="button"
          onClick={onConfirmSendFile}
          disabled={sending}
          className="wa-mediaPreview-sendBtn"
          title="Enviar"
          aria-label="Confirmar envio"
        >
          {sending ? <span className="wa-spinner" aria-hidden="true" /> : <IconSend />}
        </button>
      </div>
    </div>
  );
}

export default memo(PendingMediaPreview);
