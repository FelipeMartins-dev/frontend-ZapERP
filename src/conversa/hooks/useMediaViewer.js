import { useCallback, useEffect, useRef, useState } from "react";
import {
  printImageFromUrl,
  printImageBlob,
  captureVideoFrameToPngBlob,
} from "../mediaPrint";
import {
  fetchMediaBinaryAuthenticated,
  getMediaUrl,
  getMediaPlaybackUrl,
  mediaViewerSupportsPrint,
} from "../utils/conversaViewHelpers";

/**
 * Normaliza aliases de tipo apenas para o visualizador.
 * Não altera o contrato externo: quem chama pode continuar enviando "imagem", "video", "arquivo" etc.
 */
function normalizeViewerType(type, fileName) {
  const t = String(type || "").trim().toLowerCase();
  const fn = String(fileName || "").trim().toLowerCase();

  if (t === "image") return "imagem";
  if (t === "foto" || t === "photo" || t === "figurinha") return "imagem";
  if (t === "vídeo") return "video";
  if (t === "document" || t === "file" || t === "documento" || t === "pdf") return "arquivo";

  if (!t && fn.endsWith(".pdf")) return "arquivo";
  return t || "imagem";
}

function revokeObjectUrl(url) {
  if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

/**
 * Visualizador de mídia em tela cheia (imagem, vídeo, PDF) e impressão.
 * UI em MediaViewerOverlay; lógica concentrada neste hook.
 */
export function useMediaViewer({ showToast }) {
  const [mediaViewer, setMediaViewer] = useState(null); // { url, type, fileName }
  const [mediaPdfBlobUrl, setMediaPdfBlobUrl] = useState(null);
  const [mediaPdfLoading, setMediaPdfLoading] = useState(false);
  const [mediaPdfError, setMediaPdfError] = useState(null);
  const [mediaPrintLoading, setMediaPrintLoading] = useState(false);
  const mediaViewerImgRef = useRef(null);
  const mediaViewerVideoRef = useRef(null);
  const mediaPdfBlobUrlRef = useRef(null);

  useEffect(() => {
    mediaPdfBlobUrlRef.current = mediaPdfBlobUrl;
  }, [mediaPdfBlobUrl]);

  useEffect(
    () => () => {
      revokeObjectUrl(mediaPdfBlobUrlRef.current);
      mediaPdfBlobUrlRef.current = null;
    },
    []
  );

  const openMediaViewer = useCallback((url, type = "imagem", fileName) => {
    if (!url) return;
    const normalizedType = normalizeViewerType(type, fileName);
    setMediaViewer({
      url,
      type: normalizedType,
      fileName: fileName || null,
      originalType: type || null,
    });
  }, []);

  const closeMediaViewer = useCallback(() => {
    setMediaViewer(null);
  }, []);

  const handleMediaViewerPrint = useCallback(async () => {
    if (!mediaViewer?.url || mediaPrintLoading) return;

    const viewerType = normalizeViewerType(mediaViewer.type, mediaViewer.fileName);

    if (!mediaViewerSupportsPrint(viewerType, mediaViewer.fileName)) {
      showToast({
        type: "info",
        title: "Impressão",
        message: "Use Abrir arquivo no navegador e imprima a partir de lá.",
      });
      return;
    }

    setMediaPrintLoading(true);
    try {
      if (viewerType === "video") {
        const v = mediaViewerVideoRef.current;
        if (!v) {
          showToast({ type: "error", title: "Impressão", message: "Vídeo indisponível no visualizador." });
          return;
        }
        if (v.readyState < 2) {
          showToast({
            type: "warning",
            title: "Aguarde",
            message: "Carregue o vídeo antes de imprimir.",
          });
          return;
        }
        let blob;
        try {
          blob = await captureVideoFrameToPngBlob(v);
        } catch (e) {
          const msg = String(e?.message || "");
          if (msg === "VIDEO_FRAME_TAINTED" || msg === "VIDEO_NOT_READY") {
            showToast({
              type: "error",
              title: "Não foi possível capturar o quadro",
              message:
                msg === "VIDEO_NOT_READY"
                  ? "O vídeo ainda não tem dimensões. Aguarde um instante."
                  : "Limitação do navegador com esta origem de mídia. Baixe o arquivo e imprima localmente, se necessário.",
            });
            return;
          }
          throw e;
        }
        printImageBlob(blob);
        return;
      }

      await printImageFromUrl(mediaViewer.url);
    } catch (err) {
      if (err?.code === "POPUP_BLOCKED") {
        showToast({
          type: "warning",
          title: "Pop-up bloqueado",
          message: "Permita pop-ups para este site para abrir a janela de impressão.",
        });
        return;
      }
      console.error(err);
      showToast({
        type: "error",
        title: "Falha ao imprimir",
        message: "Não foi possível preparar a impressão. Tente de novo.",
      });
    } finally {
      setMediaPrintLoading(false);
    }
  }, [mediaViewer, mediaPrintLoading, showToast]);

  useEffect(() => {
    let cancelled = false;
    let createdPdfUrl = null;

    if (!mediaViewer) {
      setMediaPdfBlobUrl((prev) => {
        revokeObjectUrl(prev);
        return null;
      });
      setMediaPdfLoading(false);
      setMediaPdfError(null);
      return undefined;
    }

    const viewerType = normalizeViewerType(mediaViewer.type, mediaViewer.fileName);
    const fn = String(mediaViewer.fileName || "").toLowerCase();
    const isPdf = viewerType === "arquivo" && (fn.endsWith(".pdf") || mediaViewer.originalType === "pdf");

    if (!isPdf) {
      setMediaPdfBlobUrl((prev) => {
        revokeObjectUrl(prev);
        return null;
      });
      setMediaPdfLoading(false);
      setMediaPdfError(null);
      return undefined;
    }

    setMediaPdfLoading(true);
    setMediaPdfError(null);
    setMediaPdfBlobUrl((prev) => {
      revokeObjectUrl(prev);
      return null;
    });

    const abs = getMediaPlaybackUrl(mediaViewer.url, false) || getMediaUrl(mediaViewer.url, false);

    (async () => {
      try {
        const blob = await fetchMediaBinaryAuthenticated(abs);
        const pdfBlob =
          blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
        createdPdfUrl = URL.createObjectURL(pdfBlob);

        if (cancelled) {
          revokeObjectUrl(createdPdfUrl);
          createdPdfUrl = null;
          return;
        }

        setMediaPdfBlobUrl(createdPdfUrl);
      } catch (e) {
        if (!cancelled) {
          setMediaPdfError(String(e?.message || e || "Erro ao carregar o documento."));
        }
      } finally {
        if (!cancelled) setMediaPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mediaViewer]);

  return {
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
  };
}
