import api from "../api/http";
import { getApiBaseUrl } from "../api/baseUrl";

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
 * URLs absolutas para outros domínios (ex.: S3 UltraMsg) falham no browser por CORS
 * se o axios buscar direto — o backend expõe GET /media/proxy com JWT.
 */
export function isCrossOriginMediaUrl(urlStr) {
  const s = String(urlStr).trim();
  if (!s || s.startsWith("blob:") || s.startsWith("data:")) return false;
  if (s.startsWith("/")) return false;

  let u;
  try {
    u = new URL(s);
  } catch {
    return false;
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  let apiOrigin = null;
  try {
    apiOrigin = new URL(getApiBaseUrl()).origin;
  } catch {
    apiOrigin = null;
  }

  if (apiOrigin && u.origin === apiOrigin) return false;

  if (typeof window !== "undefined" && u.origin === window.location.origin) return false;

  return true;
}

/**
 * Obtém Blob da mídia para impressão.
 * URLs da própria API: axios (Bearer). blob:/data:/ fetch local.
 * URLs externas (S3, etc.): proxy autenticado /media/proxy.
 */
export async function fetchMediaBlobForPrint(url) {
  if (!url) throw new Error("NO_URL");
  const u = String(url).trim();
  if (u.startsWith("blob:") || u.startsWith("data:")) {
    const res = await fetch(u);
    if (!res.ok) throw new Error("FETCH_FAILED");
    return await res.blob();
  }

  const path = isCrossOriginMediaUrl(u) ? `/media/proxy?url=${encodeURIComponent(u)}` : u;

  const { data } = await api.get(path, {
    responseType: "blob",
    skipGlobal403Toast: true,
    skipGlobal500Toast: true,
  });
  if (!(data instanceof Blob)) throw new Error("INVALID_BLOB");
  return data;
}

/**
 * Imprime um blob de imagem com iframe oculto no documento atual (sem nova janela).
 *
 * - Escreve o HTML no `contentDocument` do iframe (não usa `window.open`; evita `noopener`
 *   e perda de referência ao documento da aba).
 * - Define `img.src` com object URL do blob; em `onload` chama `contentWindow.print()`.
 * - Remove o iframe e faz `revokeObjectURL` após `afterprint` (com fallback por tempo).
 *
 * @param {Blob} blob
 */
export function printImageBlob(blob) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("INVALID_BLOB");
  }

  const objectUrl = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Impressão");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    visibility: "hidden",
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      URL.revokeObjectURL(objectUrl);
    } catch (_) {}
    try {
      iframe.remove();
    } catch (_) {}
  };

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    cleanup();
    throw new Error("PRINT_IFRAME");
  }

  doc.open();
  doc.write(PRINT_HTML);
  doc.close();

  const img = doc.getElementById("printImg");
  if (!img) {
    cleanup();
    throw new Error("PRINT_DOM");
  }

  let printFlowStarted = false;

  const startPrintFlow = () => {
    if (printFlowStarted) return;
    printFlowStarted = true;

    let fallbackId = null;
    const safeCleanup = () => {
      if (fallbackId != null) {
        clearTimeout(fallbackId);
        fallbackId = null;
      }
      cleanup();
    };

    fallbackId = window.setTimeout(safeCleanup, 120_000);
    win.addEventListener("afterprint", safeCleanup, { once: true });

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          win.focus();
          win.print();
        } catch (_) {
          safeCleanup();
        }
      });
    });
  };

  img.onload = () => {
    startPrintFlow();
  };

  img.onerror = () => {
    cleanup();
  };

  img.src = objectUrl;

  if (img.complete && img.naturalWidth > 0) {
    startPrintFlow();
  }
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
