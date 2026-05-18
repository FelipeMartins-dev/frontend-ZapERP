/** @param {string} url */
export function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (e) => reject(e));
    image.crossOrigin = "anonymous";
    image.src = url;
  });
}

/** @param {number} degree */
function toRadians(degree) {
  return (degree * Math.PI) / 180;
}

/** Crop em % ou px (coordenadas da imagem exibida) → pixels da imagem original. */
export function cropToNaturalPixels(crop, imageEl) {
  if (!crop || !imageEl?.width || !imageEl?.height) return null;
  const { width: dw, height: dh, naturalWidth: nw, naturalHeight: nh } = imageEl;
  let x;
  let y;
  let w;
  let h;
  if (crop.unit === "%") {
    x = ((crop.x || 0) / 100) * dw;
    y = ((crop.y || 0) / 100) * dh;
    w = ((crop.width || 0) / 100) * dw;
    h = ((crop.height || 0) / 100) * dh;
  } else {
    x = crop.x || 0;
    y = crop.y || 0;
    w = crop.width || 0;
    h = crop.height || 0;
  }
  if (w <= 0 || h <= 0) return null;
  const scaleX = nw / dw;
  const scaleY = nh / dh;
  return {
    x: Math.max(0, Math.round(x * scaleX)),
    y: Math.max(0, Math.round(y * scaleY)),
    width: Math.min(nw, Math.round(w * scaleX)),
    height: Math.min(nh, Math.round(h * scaleY)),
  };
}

/** Gira 90° e devolve nova URL blob (revogar a anterior no componente). */
export async function rotateImageBlobUrl(imageSrc) {
  const image = await loadImageElement(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");
  canvas.width = image.height;
  canvas.height = image.width;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao girar."))), "image/jpeg", 0.92);
  });
  return URL.createObjectURL(blob);
}

export const FULL_IMAGE_CROP_PERCENT = { unit: "%", x: 0, y: 0, width: 100, height: 100 };

/**
 * Gera File recortado (com rotação opcional) a partir do crop em pixels.
 * @param {{
 *   imageSrc: string;
 *   pixelCrop: { x: number; y: number; width: number; height: number };
 *   rotation?: number;
 *   fileName?: string;
 *   mimeType?: string;
 *   maxEdge?: number;
 * }} opts
 */
export async function exportCroppedImageFile(opts) {
  const {
    imageSrc,
    pixelCrop,
    rotation = 0,
    fileName = `foto-${Date.now()}.jpg`,
    mimeType = "image/jpeg",
    maxEdge = 2048,
  } = opts;

  const image = await loadImageElement(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");

  const rotRad = toRadians(rotation);
  const bBoxWidth = Math.abs(Math.cos(rotRad) * image.width) + Math.abs(Math.sin(rotRad) * image.height);
  const bBoxHeight = Math.abs(Math.sin(rotRad) * image.width) + Math.abs(Math.cos(rotRad) * image.height);

  canvas.width = bBoxWidth;
  canvas.height = bBoxHeight;

  ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
  ctx.rotate(rotRad);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);

  const croppedCanvas = document.createElement("canvas");
  const croppedCtx = croppedCanvas.getContext("2d");
  if (!croppedCtx) throw new Error("Canvas indisponível.");

  let outW = pixelCrop.width;
  let outH = pixelCrop.height;
  const scale = Math.min(1, maxEdge / Math.max(outW, outH, 1));
  outW = Math.max(1, Math.round(outW * scale));
  outH = Math.max(1, Math.round(outH * scale));

  croppedCanvas.width = outW;
  croppedCanvas.height = outH;

  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outW,
    outH
  );

  const outputMime = mimeType === "image/png" ? "image/png" : "image/jpeg";
  const quality = outputMime === "image/jpeg" ? 0.92 : undefined;

  const blob = await new Promise((resolve, reject) => {
    croppedCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao exportar imagem."))),
      outputMime,
      quality
    );
  });

  const ext =
    outputMime === "image/png"
      ? ".png"
      : outputMime === "image/webp"
        ? ".webp"
        : ".jpg";
  const safeName = String(fileName || "foto").replace(/\.[^.]+$/, "") + ext;

  return new File([blob], safeName, { type: outputMime, lastModified: Date.now() });
}
