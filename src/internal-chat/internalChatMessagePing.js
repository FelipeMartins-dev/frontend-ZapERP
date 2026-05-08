/**
 * Sinal sonoro curto para nova mensagem no chat interno (sem ficheiro externo).
 */
export function playInternalChatMessagePing() {
  if (typeof window === "undefined") return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.15);
    const close = () => {
      try {
        ctx.close();
      } catch {
        /* ignore */
      }
    };
    setTimeout(close, 400);
  } catch {
    /* ignore */
  }
}
