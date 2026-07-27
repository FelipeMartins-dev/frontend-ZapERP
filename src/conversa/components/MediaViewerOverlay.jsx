import { useEffect } from "react";
import { createPortal } from "react-dom";
import { getMediaPlaybackUrl, mediaViewerSupportsPrint } from "../utils/conversaViewHelpers";
import { IconClose, IconPrint } from "../conversaViewIcons";

/**
 * Visualizador de mídia em tela cheia. Monta só quando `mediaViewer` está definido.
 * Estados de PDF/impressão e efeitos de carregamento permanecem no pai.
 */
export default function MediaViewerOverlay({
  mediaViewer,
  mediaPdfBlobUrl,
  mediaPdfLoading,
  mediaPdfError,
  mediaPrintLoading,
  mediaViewerImgRef,
  mediaViewerVideoRef,
  onClose,
  onPrint,
}) {
  useEffect(() => {
    if (!mediaViewer) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mediaViewer, onClose]);

  if (!mediaViewer) return null;

  return createPortal(
    <div
      className="wa-modalOverlay wa-mediaViewerOverlay"
      role="dialog"
      aria-label="Visualizar mídia"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="wa-mediaViewer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wa-mediaViewer-actions">
          {mediaViewerSupportsPrint(mediaViewer.type, mediaViewer.fileName) ? (
            <button
              type="button"
              className="wa-mediaViewer-print"
              onClick={onPrint}
              disabled={mediaPrintLoading}
              title="Imprimir"
              aria-label="Imprimir"
              aria-busy={mediaPrintLoading}
            >
              <IconPrint />
            </button>
          ) : null}
          <button
            type="button"
            className="wa-mediaViewer-close"
            onClick={onClose}
            title="Fechar (Esc)"
            aria-label="Fechar"
          >
            <IconClose />
          </button>
        </div>
        {mediaViewer.type === "video" ? (
          <div className="wa-mediaViewer-videoWrap">
            <video
              ref={mediaViewerVideoRef}
              src={mediaViewer.url}
              controls
              autoPlay
              playsInline
              className="wa-mediaViewer-video"
            />
            <p className="wa-mediaViewer-videoPrintHint" role="note">
              A impressão usa o quadro exibido no momento. Navegadores costumam não imprimir o elemento de vídeo
              diretamente; usamos a imagem do frame atual.
            </p>
          </div>
        ) : mediaViewer.type === "arquivo" ? (
          (() => {
            const fn = (mediaViewer.fileName || "").toLowerCase();
            const isPdf = fn.endsWith(".pdf");
            const isImg = /\.(jpg|jpeg|png|gif|webp|bmp|avif|svg)$/i.test(fn);
            if (isImg) {
              return (
                <img
                  ref={mediaViewerImgRef}
                  src={mediaViewer.url}
                  alt={mediaViewer.fileName || "Arquivo"}
                  className="wa-mediaViewer-img"
                />
              );
            }
            if (isPdf) {
              const absUrl = getMediaPlaybackUrl(mediaViewer.url, false) || mediaViewer.url;
              if (mediaPdfLoading) {
                return (
                  <div className="wa-mediaViewer-iframe wa-mediaViewer-pdfState" role="status" aria-busy="true">
                    Carregando documento…
                  </div>
                );
              }
              if (mediaPdfError) {
                return (
                  <div className="wa-mediaViewer-iframe wa-mediaViewer-pdfState">
                    <span className="wa-mediaViewer-fileIcon" aria-hidden="true">
                      📎
                    </span>
                    <span>Não foi possível exibir o PDF nesta janela ({mediaPdfError}).</span>
                    <a href={absUrl} target="_blank" rel="noreferrer" className="wa-btn wa-btn-primary">
                      Abrir em nova aba
                    </a>
                  </div>
                );
              }
              if (mediaPdfBlobUrl) {
                return (
                  <iframe
                    src={mediaPdfBlobUrl}
                    title={mediaViewer.fileName || "Documento"}
                    className="wa-mediaViewer-iframe"
                  />
                );
              }
              return (
                <div className="wa-mediaViewer-iframe wa-mediaViewer-pdfState" role="status">
                  Preparando documento…
                </div>
              );
            }
            return (
              <div className="wa-mediaViewer-file">
                <span className="wa-mediaViewer-fileIcon">📎</span>
                <span className="wa-mediaViewer-fileName">{mediaViewer.fileName || "Arquivo"}</span>
                <a href={mediaViewer.url} target="_blank" rel="noreferrer" className="wa-btn wa-btn-primary">
                  Abrir arquivo
                </a>
              </div>
            );
          })()
        ) : (
          <img
            ref={mediaViewerImgRef}
            src={mediaViewer.url}
            alt={mediaViewer.type === "figurinha" ? "Figurinha" : "Imagem"}
            className="wa-mediaViewer-img"
          />
        )}
      </div>
    </div>,
    document.body
  );
}
