import { lazy, memo, Suspense, useEffect, useLayoutEffect } from "react";
import {
  isImageFile,
  isVideoFile,
  isAudioFile,
  isEditableImageForSend,
  formatFileSize,
} from "../utils/conversaViewHelpers";

/** Deriva cor, label e extensão a partir do arquivo para o card de preview. */
function getFileTypeInfo(file) {
  const name = String(file?.name || "").toLowerCase();
  const mime = String(file?.type || "").toLowerCase();
  const rawExt = name.includes(".") ? name.split(".").pop().toUpperCase() : "FILE";
  const ext = rawExt.slice(0, 5);

  if (isAudioFile(file))
    return { ext, label: "Áudio", color: "#a78bfa", bg: "rgba(167,139,250,0.14)" };
  if (mime.includes("pdf") || name.endsWith(".pdf"))
    return { ext: "PDF", label: "PDF", color: "#f87171", bg: "rgba(248,113,113,0.13)" };
  if (mime.includes("word") || mime.includes("msword") || name.endsWith(".doc") || name.endsWith(".docx"))
    return { ext, label: "Word", color: "#60a5fa", bg: "rgba(96,165,250,0.13)" };
  if (mime.includes("sheet") || mime.includes("excel") || name.endsWith(".xls") || name.endsWith(".xlsx"))
    return { ext, label: "Excel", color: "#34d399", bg: "rgba(52,211,153,0.13)" };
  if (name.endsWith(".csv"))
    return { ext: "CSV", label: "Planilha CSV", color: "#34d399", bg: "rgba(52,211,153,0.13)" };
  if (mime.includes("presentation") || name.endsWith(".ppt") || name.endsWith(".pptx"))
    return { ext, label: "PowerPoint", color: "#fb923c", bg: "rgba(251,146,60,0.13)" };
  if (name.endsWith(".txt"))
    return { ext: "TXT", label: "Texto", color: "#94a3b8", bg: "rgba(148,163,184,0.13)" };
  if (name.endsWith(".xml"))
    return { ext: "XML", label: "XML", color: "#fbbf24", bg: "rgba(251,191,36,0.13)" };
  if (name.endsWith(".json"))
    return { ext: "JSON", label: "JSON", color: "#fbbf24", bg: "rgba(251,191,36,0.13)" };
  if (name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".7z") || name.endsWith(".tar") || name.endsWith(".gz"))
    return { ext, label: "Compactado", color: "#fbbf24", bg: "rgba(251,191,36,0.13)" };
  return { ext, label: "Arquivo", color: "#94a3b8", bg: "rgba(148,163,184,0.13)" };
}
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
        ) : (() => {
          const typeInfo = getFileTypeInfo(pendingFile);
          const sizeStr = formatFileSize(pendingFile.size) || "—";
          return (
            <div
              className="wa-fileSendPreview-card"
              style={{ "--fsp-clr": typeInfo.color, "--fsp-bg": typeInfo.bg }}
            >
              {/* Ícone do tipo de arquivo */}
              <div className="wa-fileSendPreview-iconArea" aria-hidden="true">
                <div className="wa-fileSendPreview-iconBox">
                  <svg
                    className="wa-fileSendPreview-docShape"
                    viewBox="0 0 48 60"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 0h24l12 12v42a6 6 0 01-6 6H6a6 6 0 01-6-6V6a6 6 0 016-6z"
                      fill="var(--fsp-clr)"
                      opacity="0.18"
                    />
                    <path
                      d="M30 0l12 12H35a5 5 0 01-5-5V0z"
                      fill="var(--fsp-clr)"
                      opacity="0.3"
                    />
                    <rect x="8" y="26" width="18" height="2.5" rx="1.25" fill="rgba(255,255,255,0.22)" />
                    <rect x="8" y="33" width="24" height="2.5" rx="1.25" fill="rgba(255,255,255,0.22)" />
                    <rect x="8" y="40" width="14" height="2.5" rx="1.25" fill="rgba(255,255,255,0.22)" />
                  </svg>
                  <span className="wa-fileSendPreview-extLabel">{typeInfo.ext}</span>
                </div>
              </div>

              {/* Nome e metadados */}
              <div className="wa-fileSendPreview-info">
                <div className="wa-fileSendPreview-filename" title={pendingFile.name}>
                  {pendingFile.name}
                </div>
                <div className="wa-fileSendPreview-details">
                  <span className="wa-fileSendPreview-typeBadge">{typeInfo.label}</span>
                  <span className="wa-fileSendPreview-detailDot" aria-hidden="true">·</span>
                  <span className="wa-fileSendPreview-sizeText">{sizeStr}</span>
                </div>
              </div>

              {/* Status */}
              <div className="wa-fileSendPreview-readyBadge">
                <span className="wa-fileSendPreview-readyDot" aria-hidden="true" />
                <span>
                  {isAudioFile(pendingFile) ? "Áudio pronto para envio" : "Arquivo pronto para envio"}
                </span>
              </div>
            </div>
          );
        })()}
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
