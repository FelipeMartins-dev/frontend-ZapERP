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
