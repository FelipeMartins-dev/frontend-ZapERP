import api from "../api/http";

const PRINT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  body { display: flex; justify-content: center; align-items: flex-start; min-height: 100%; box-sizing: border-box; padding: 8px; }
  img#printImg {
    display: block;
    max-width: 100%;
    height: auto;
    object-fit: contain;
  }
  @page { size: A4; margin: 12mm; }
  @media print {
    html, body { background: #fff; padding: 0; }
    img#printImg {
      max-width: 100%;
      page-break-inside: avoid;
    }
  }
</style>
</head>
<body><img id="printImg" alt=""/></body>
</html>`;

/**
 * Obtém Blob da mídia para impressão.
 * URLs relativas/absolutas da API usam axios (Bearer); blob:/data: via fetch.
 */
export async function fetchMediaBlobForPrint(url) {
  if (!url) throw new Error("NO_URL");
  const u = String(url).trim();
  if (u.startsWith("blob:") || u.startsWith("data:")) {
    const res = await fetch(u);
    if (!res.ok) throw new Error("FETCH_FAILED");
    return await res.blob();
  }
  const { data } = await api.get(u, { responseType: "blob" });
  if (!(data instanceof Blob)) throw new Error("INVALID_BLOB");
  return data;
}

/**
 * Abre janela mínima com <img> + CSS de impressão, chama print() após load.
 * @param {Blob} blob
 */
export function printImageBlob(blob) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("INVALID_BLOB");
  }

  const objectUrl = URL.createObjectURL(blob);
  const win = window.open("", "_blank", "noopener,noreferrer");

  if (!win) {
    URL.revokeObjectURL(objectUrl);
    const err = new Error("POPUP_BLOCKED");
    err.code = "POPUP_BLOCKED";
    throw err;
  }

  win.document.open();
  win.document.write(PRINT_HTML);
  win.document.close();

  const img = win.document.getElementById("printImg");
  if (!img) {
    URL.revokeObjectURL(objectUrl);
    try {
      win.close();
    } catch (_) {}
    throw new Error("PRINT_DOM");
  }

  const cleanup = () => {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch (_) {}
  };

  img.onload = () => {
    try {
      win.focus();
      win.print();
    } catch (_) {}
    setTimeout(cleanup, 120_000);
  };

  img.onerror = () => {
    cleanup();
    try {
      win.close();
    } catch (_) {}
    throw new Error("IMG_LOAD");
  };

  img.src = objectUrl;
}

/** Fetch autenticado + impressão só da imagem (sem UI do chat). */
export async function printImageFromUrl(url) {
  const blob = await fetchMediaBlobForPrint(url);
  printImageBlob(blob);
}

/**
 * Captura o quadro atual do vídeo (canvas). Falha se CORS/taint (origem cruzada sem permissão).
 */
export function captureVideoFrameToPngBlob(videoEl) {
  if (!videoEl || videoEl.tagName !== "VIDEO") throw new Error("NO_VIDEO");
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) throw new Error("VIDEO_NOT_READY");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("NO_CONTEXT");

  try {
    ctx.drawImage(videoEl, 0, 0, w, h);
  } catch (e) {
    const err = new Error("VIDEO_FRAME_TAINTED");
    err.cause = e;
    throw err;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("CANVAS_BLOB"));
      },
      "image/png",
      0.92
    );
  });
}
