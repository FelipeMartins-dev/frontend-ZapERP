import { useCallback, useEffect, useRef, useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Maximize2, RotateCw, X } from "lucide-react";
import {
  cropToNaturalPixels,
  FULL_IMAGE_CROP_PERCENT,
  rotateImageBlobUrl,
} from "./utils/imageCropExport.js";

/**
 * Preview unificado (mobile): imagem em tamanho natural + quadro de corte
 * arrastável/redimensionável (estilo WhatsApp). Legenda e envio inalterados no pai.
 */
export default function ImageSendPreviewMobile({
  rootRef,
  captionRef,
  imageUrl,
  fileName,
  mimeType,
  caption,
  onCaptionChange,
  sending,
  onCancel,
  onSend,
  sendIcon,
}) {
  const imgRef = useRef(null);
  const displayUrlRef = useRef(imageUrl);
  const [displayUrl, setDisplayUrl] = useState(imageUrl);
  const [crop, setCrop] = useState(FULL_IMAGE_CROP_PERCENT);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [sendAsOriginal, setSendAsOriginal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rotating, setRotating] = useState(false);

  const busy = sending || exporting || rotating;

  const syncPixelCrop = useCallback((nextCrop) => {
    const img = imgRef.current;
    if (!img) return;
    const pixels = cropToNaturalPixels(nextCrop, img);
    if (pixels) setCroppedAreaPixels(pixels);
  }, []);

  const onImageLoad = useCallback(
    (e) => {
      imgRef.current = e.currentTarget;
      const initial = FULL_IMAGE_CROP_PERCENT;
      setCrop(initial);
      requestAnimationFrame(() => syncPixelCrop(initial));
    },
    [syncPixelCrop]
  );

  const onCropChange = useCallback(
    (nextCrop) => {
      setCrop(nextCrop);
      syncPixelCrop(nextCrop);
    },
    [syncPixelCrop]
  );

  const handleResetCrop = useCallback(() => {
    setCrop(FULL_IMAGE_CROP_PERCENT);
    syncPixelCrop(FULL_IMAGE_CROP_PERCENT);
  }, [syncPixelCrop]);

  const handleRotate = useCallback(async () => {
    if (rotating || sendAsOriginal) return;
    setRotating(true);
    try {
      const prev = displayUrlRef.current;
      const next = await rotateImageBlobUrl(prev);
      if (prev && prev !== imageUrl && prev.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          /* ignore */
        }
      }
      displayUrlRef.current = next;
      setDisplayUrl(next);
      setCrop(FULL_IMAGE_CROP_PERCENT);
    } catch (err) {
      console.error("[ImageSendPreviewMobile] rotate:", err);
    } finally {
      setRotating(false);
    }
  }, [imageUrl, rotating, sendAsOriginal]);

  useEffect(() => {
    displayUrlRef.current = imageUrl;
    setDisplayUrl(imageUrl);
    setCrop(FULL_IMAGE_CROP_PERCENT);
  }, [imageUrl]);

  useEffect(
    () => () => {
      const u = displayUrlRef.current;
      if (u && u !== imageUrl && String(u).startsWith("blob:")) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
    },
    [imageUrl]
  );

  const handleSend = useCallback(async () => {
    if (busy) return;
    setExporting(true);
    try {
      let pixels = croppedAreaPixels;
      if (!sendAsOriginal && imgRef.current && crop) {
        pixels = cropToNaturalPixels(crop, imgRef.current) || pixels;
      }
      await onSend({
        sendAsOriginal,
        croppedAreaPixels: pixels,
        rotation: 0,
        fileName: fileName || "foto.jpg",
        mimeType: mimeType || "image/jpeg",
      });
    } catch (err) {
      console.error("[ImageSendPreviewMobile] envio:", err);
    } finally {
      setExporting(false);
    }
  }, [busy, crop, croppedAreaPixels, fileName, mimeType, onSend, sendAsOriginal]);

  return (
    <div
      ref={rootRef}
      className="wa-mediaPreview wa-mediaPreview--imageUnified"
      role="dialog"
      aria-modal="true"
      aria-label="Enviar foto"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="wa-mediaPreview-head wa-mediaPreview-head--overlay">
        <button
          type="button"
          className="wa-mediaPreview-close wa-imageSend-closeBtn"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancelar envio"
          title="Cancelar"
        >
          <X size={22} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="wa-mediaPreview-title">Enviar foto</span>
        <span className="wa-mediaPreview-spacer" aria-hidden="true" />
      </div>

      <div className="wa-mediaPreview-stage wa-mediaPreview-stage--crop">
        <div className="wa-imageSend-canvas">
          {sendAsOriginal ? (
            <img
              ref={imgRef}
              src={displayUrl}
              alt="Foto original a enviar"
              className="wa-imageSend-photo wa-imageSend-photo--full"
              draggable={false}
              onLoad={onImageLoad}
            />
          ) : (
            <ReactCrop
              className="wa-imageSend-reactCrop ReactCrop--no-animate"
              crop={crop}
              ruleOfThirds
              onChange={(_, percentCrop) => onCropChange(percentCrop)}
              onComplete={(_, percentCrop) => onCropChange(percentCrop)}
            >
              <img
                ref={imgRef}
                src={displayUrl}
                alt="Ajuste o quadro para recortar a foto"
                className="wa-imageSend-photo"
                draggable={false}
                onLoad={onImageLoad}
              />
            </ReactCrop>
          )}
        </div>

        {sendAsOriginal ? (
          <span className="wa-imageSend-originalBadge" aria-live="polite">
            Foto original
          </span>
        ) : null}
      </div>

      <div className="wa-imageSendEditBar" role="toolbar" aria-label="Ferramentas de recorte">
        <button
          type="button"
          className="wa-imageSendEditBar-btn"
          onClick={handleRotate}
          disabled={busy || sendAsOriginal}
          aria-label="Girar imagem"
          title="Girar"
        >
          <RotateCw size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="wa-imageSendEditBar-reset"
          onClick={handleResetCrop}
          disabled={busy || sendAsOriginal}
        >
          Redefinir
        </button>

        <button
          type="button"
          className={`wa-imageSendEditBar-btn wa-imageSendEditBar-btn--end${sendAsOriginal ? " is-active" : ""}`}
          disabled={busy}
          onClick={() => setSendAsOriginal((v) => !v)}
          aria-label={sendAsOriginal ? "Voltar ao recorte" : "Enviar foto original sem corte"}
          aria-pressed={sendAsOriginal}
          title={sendAsOriginal ? "Recortar" : "Original"}
        >
          <Maximize2 size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="wa-mediaPreview-composer">
        <div className="wa-mediaPreview-inputWrap">
          <textarea
            ref={captionRef}
            value={caption}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy) handleSend();
              }
            }}
            placeholder="Adicionar legenda (opcional)…"
            rows={1}
            className="wa-mediaPreview-input"
            disabled={busy}
            aria-label="Legenda ou comentário junto ao envio"
            enterKeyHint="send"
            maxLength={1024}
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={busy}
          className="wa-mediaPreview-sendBtn"
          title="Enviar"
          aria-label="Confirmar envio"
        >
          {busy ? <span className="wa-spinner" aria-hidden="true" /> : sendIcon}
        </button>
      </div>
    </div>
  );
}
