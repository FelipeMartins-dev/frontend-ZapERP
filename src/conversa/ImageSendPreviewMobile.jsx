import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { RotateCw, X } from "lucide-react";

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

  const onCropComplete = useCallback((_area, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
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
          className="wa-mediaPreview-close"
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
            cropShape="rect"
            showGrid={false}
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
      </div>

      <div className="wa-imageSendToolbar">
        <button
          type="button"
          className="wa-imageEditor-toolBtn"
          onClick={handleRotate}
          disabled={busy || sendAsOriginal}
          aria-label="Girar 90 graus"
          title="Girar"
        >
          <RotateCw size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        <label
          className={`wa-imageEditor-zoom${sendAsOriginal ? " wa-imageEditor-zoom--disabled" : ""}`}
          aria-label="Zoom da imagem"
        >
          <span className="wa-imageEditor-zoomLabel" aria-hidden="true">
            −
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.02}
            value={zoom}
            disabled={busy || sendAsOriginal}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="wa-imageEditor-zoomInput"
          />
          <span className="wa-imageEditor-zoomLabel" aria-hidden="true">
            +
          </span>
        </label>

        <div className="wa-imageSendMode" role="group" aria-label="Modo de envio da foto">
          <button
            type="button"
            className={`wa-imageSendMode-btn${!sendAsOriginal ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => setSendAsOriginal(false)}
            aria-pressed={!sendAsOriginal}
          >
            Ajustar
          </button>
          <button
            type="button"
            className={`wa-imageSendMode-btn${sendAsOriginal ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => setSendAsOriginal(true)}
            aria-pressed={sendAsOriginal}
          >
            Original
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
