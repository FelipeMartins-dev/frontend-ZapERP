import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { Check, RotateCw, X } from "lucide-react";
import { exportCroppedImageFile } from "./utils/imageCropExport.js";

/**
 * Editor de imagem antes do envio (mobile) — crop, zoom e rotação.
 * Não altera envio/legenda; apenas devolve um File editado via onConfirm.
 */
export default function ImageSendEditor({ imageUrl, fileName, mimeType, onCancel, onConfirm }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_croppedArea, croppedPixels) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!croppedAreaPixels || busy) return;
    setBusy(true);
    try {
      const file = await exportCroppedImageFile({
        imageSrc: imageUrl,
        pixelCrop: croppedAreaPixels,
        rotation,
        fileName: fileName || "foto.jpg",
        mimeType: mimeType || "image/jpeg",
      });
      await onConfirm(file);
    } catch (err) {
      console.error("[ImageSendEditor] export:", err);
      setBusy(false);
    }
  }, [busy, croppedAreaPixels, fileName, imageUrl, mimeType, onConfirm, rotation]);

  return (
    <div
      className="wa-imageEditor"
      role="dialog"
      aria-modal="true"
      aria-label="Editar foto antes de enviar"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="wa-imageEditor-head">
        <button
          type="button"
          className="wa-imageEditor-iconBtn"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancelar edição"
          title="Cancelar"
        >
          <X size={22} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="wa-imageEditor-title">Editar foto</span>
        <button
          type="button"
          className="wa-imageEditor-iconBtn wa-imageEditor-iconBtn--primary"
          onClick={handleConfirm}
          disabled={busy || !croppedAreaPixels}
          aria-label="Concluir edição"
          title="Concluir"
        >
          {busy ? (
            <span className="wa-spinner" aria-hidden="true" />
          ) : (
            <Check size={22} strokeWidth={2.25} aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="wa-imageEditor-stage">
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
      </div>

      <div className="wa-imageEditor-controls">
        <button
          type="button"
          className="wa-imageEditor-toolBtn"
          onClick={handleRotate}
          disabled={busy}
          aria-label="Girar 90 graus"
          title="Girar"
        >
          <RotateCw size={22} strokeWidth={2} aria-hidden="true" />
        </button>

        <label className="wa-imageEditor-zoom" aria-label="Zoom da imagem">
          <span className="wa-imageEditor-zoomLabel" aria-hidden="true">
            −
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.02}
            value={zoom}
            disabled={busy}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="wa-imageEditor-zoomInput"
          />
          <span className="wa-imageEditor-zoomLabel" aria-hidden="true">
            +
          </span>
        </label>

        <span className="wa-imageEditor-toolSpacer" aria-hidden="true" />
      </div>
    </div>
  );
}
