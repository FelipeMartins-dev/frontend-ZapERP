import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { Crop, Maximize2, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.18;

/**
 * Preview unificado (mobile): crop/zoom/pan + legenda + envio numa única tela.
 * O envio em si é delegado ao pai (handleEnviarArquivo inalterado).
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
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [sendAsOriginal, setSendAsOriginal] = useState(false);
  const [exporting, setExporting] = useState(false);

  const busy = sending || exporting;
  const cropMode = !sendAsOriginal;

  const onCropComplete = useCallback((_area, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, Number((z + ZOOM_STEP).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, Number((z - ZOOM_STEP).toFixed(2))));
  }, []);

  const handleSend = useCallback(async () => {
    if (busy) return;
    setExporting(true);
    try {
      await onSend({
        sendAsOriginal,
        croppedAreaPixels,
        rotation,
        fileName: fileName || "foto.jpg",
        mimeType: mimeType || "image/jpeg",
      });
    } catch (err) {
      console.error("[ImageSendPreviewMobile] envio:", err);
    } finally {
      setExporting(false);
    }
  }, [busy, croppedAreaPixels, fileName, mimeType, onSend, rotation, sendAsOriginal]);

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
        {sendAsOriginal ? (
          <img
            src={imageUrl}
            alt="Foto original a enviar"
            className="wa-mediaPreview-media wa-mediaPreview-media--original"
            draggable={false}
          />
        ) : (
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            minZoom={ZOOM_MIN}
            maxZoom={ZOOM_MAX}
            cropShape="rect"
            showGrid
            restrictPosition={false}
            objectFit="contain"
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={onCropComplete}
            classes={{
              containerClassName: "wa-imageEditor-cropper",
              mediaClassName: "wa-imageEditor-cropperMedia",
              cropAreaClassName: "wa-imageEditor-cropArea",
            }}
          />
        )}

        {sendAsOriginal ? (
          <span className="wa-imageSend-originalBadge" aria-live="polite">
            Foto original
          </span>
        ) : null}

        <div className="wa-imageSendFloatTools" role="toolbar" aria-label="Ferramentas de edição">
          <button
            type="button"
            className="wa-imageSendTool"
            onClick={handleRotate}
            disabled={busy || sendAsOriginal}
            aria-label="Girar imagem"
            title="Girar"
          >
            <RotateCw size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="wa-imageSendTool"
            onClick={handleZoomOut}
            disabled={busy || sendAsOriginal || zoom <= ZOOM_MIN}
            aria-label="Diminuir zoom"
            title="Diminuir zoom"
          >
            <ZoomOut size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="wa-imageSendTool"
            onClick={handleZoomIn}
            disabled={busy || sendAsOriginal || zoom >= ZOOM_MAX}
            aria-label="Aumentar zoom"
            title="Aumentar zoom"
          >
            <ZoomIn size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <span className="wa-imageSendToolSep" aria-hidden="true" />

          <button
            type="button"
            className={`wa-imageSendTool${cropMode ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => setSendAsOriginal(false)}
            aria-label="Ajustar enquadramento"
            aria-pressed={cropMode}
            title="Recortar e ajustar"
          >
            <Crop size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`wa-imageSendTool${!cropMode ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => setSendAsOriginal(true)}
            aria-label="Enviar foto original sem corte"
            aria-pressed={!cropMode}
            title="Foto original"
          >
            <Maximize2 size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
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
