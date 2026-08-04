import { useLayoutEffect, useRef } from "react";
import { snapThreadToBottom } from "./useAutoScroll";

/**
 * Mobile: mantém o cabeçalho fixo na viewport e ajusta a área de mensagens quando o teclado
 * virtual abre/fecha (via visualViewport). Escreve as CSS vars usadas pelo layout do thread
 * (--wa-mobile-header-h, --wa-vv-top, --wa-keyboard-inset, --wa-visual-height,
 * --wa-composer-stack-h) e reancora ao fim quando o utilizador já estava colado à última
 * mensagem (guardado por shouldStickToBottomRef / userScrollLockRef — quem lê histórico não
 * é puxado para baixo).
 *
 * Extraído do ConversaView sem alterar o comportamento: mesmo corpo, mesmas dependências.
 */
export function useMobileKeyboardViewport({
  conversaId,
  waShellRef,
  waHeaderRef,
  composerRef,
  messagesContainerRef,
  virtualThreadRef,
  shouldStickToBottomRef,
  userScrollLockRef,
  recordingActiveRef,
}) {
  const mobileFullViewportHeightRef = useRef(0);
  const mobileKeyboardWasVisibleRef = useRef(false);
  const mobileKeyboardInsetRef = useRef(0);

  useLayoutEffect(() => {
    const shell = waShellRef.current;
    const header = waHeaderRef.current;
    if (!shell || !header) return;

    mobileFullViewportHeightRef.current = 0;
    mobileKeyboardWasVisibleRef.current = false;
    mobileKeyboardInsetRef.current = 0;

    const mq = window.matchMedia("(max-width: 640px)");
    const root = document.documentElement;
    const getComposerInput = () => composerRef.current?.getInputElement?.() ?? null;

    const setViewportCssVars = (vars) => {
      for (const [key, value] of Object.entries(vars)) {
        if (value == null) {
          shell.style.removeProperty(key);
          root.style.removeProperty(key);
        } else {
          shell.style.setProperty(key, value);
          root.style.setProperty(key, value);
        }
      }
    };

    const syncHeaderLayout = () => {
      if (!mq.matches) {
        setViewportCssVars({
          "--wa-mobile-header-h": null,
          "--wa-vv-top": null,
          "--wa-keyboard-inset": null,
          "--wa-visual-height": null,
          "--wa-composer-stack-h": null,
        });
        shell.classList.remove("wa-keyboard-visible");
        mobileKeyboardWasVisibleRef.current = false;
        return;
      }

      // Fase de LEITURA: todas as medições antes de qualquer escrita no DOM.
      // Intercalar leitura/escrita força reflows síncronos — este handler roda
      // dezenas de vezes durante a animação do teclado (visualViewport resize/scroll).
      const headerH = header.offsetHeight;
      const mediaPreviewOpen = Boolean(shell.querySelector(".wa-mediaPreview"));
      const stack = mediaPreviewOpen ? null : shell.querySelector(".wa-composerStack");
      const stackH = stack ? Math.ceil(stack.getBoundingClientRect().height) : null;
      const vvNow = window.visualViewport;
      const input = getComposerInput();
      const inputFocused = Boolean(input && document.activeElement === input);
      const ih = window.innerHeight;

      // Fase de ESCRITA
      shell.style.setProperty("--wa-mobile-header-h", `${headerH}px`);
      root.style.setProperty("--wa-mobile-header-h", `${headerH}px`);

      if (mediaPreviewOpen) {
        shell.classList.remove("wa-keyboard-visible");
        mobileKeyboardWasVisibleRef.current = false;
        setViewportCssVars({
          "--wa-vv-top": null,
          "--wa-keyboard-inset": null,
          "--wa-visual-height": null,
          "--wa-composer-stack-h": null,
        });
        return;
      }

      if (vvNow) {
        const visibleH = vvNow.height;
        const kbInset = Math.max(0, ih - visibleH - vvNow.offsetTop);
        if (!inputFocused && kbInset < 48) {
          mobileFullViewportHeightRef.current = Math.max(
            mobileFullViewportHeightRef.current,
            visibleH,
            ih
          );
        }
        const baseline = mobileFullViewportHeightRef.current || ih;
        const keyboardOpen =
          kbInset > 48 || (inputFocused && visibleH < baseline - 72);

        setViewportCssVars({
          "--wa-vv-top": `${vvNow.offsetTop}px`,
          "--wa-keyboard-inset": `${kbInset}px`,
          "--wa-visual-height": `${visibleH}px`,
          "--wa-composer-stack-h": stackH != null ? `${stackH}px` : null,
        });

        const wasKeyboard = mobileKeyboardWasVisibleRef.current;
        const prevInset = mobileKeyboardInsetRef.current;
        shell.classList.toggle("wa-keyboard-visible", keyboardOpen);
        mobileKeyboardWasVisibleRef.current = keyboardOpen;
        mobileKeyboardInsetRef.current = kbInset;
        if (!keyboardOpen && wasKeyboard && !recordingActiveRef.current) {
          // Se o teclado fechou porque a gravação começou, NÃO solta a âncora ao fim —
          // o handleRecordingStateChange mantém a tela fixa nas últimas mensagens.
          shouldStickToBottomRef.current = false;
        }
        /*
         * Só reancora quando o teclado ABRE ou a inset muda de forma relevante.
         * Antes: cada syncHeaderLayout (incl. troca de conversaId → sync + rAF + 3 timers)
         * disparava snap enquanto o teclado estivesse aberto, competindo com o useAutoScroll
         * na abertura e produzindo “pulos” em cascata.
         */
        const keyboardJustOpened = keyboardOpen && !wasKeyboard;
        const insetChangedWhileOpen =
          keyboardOpen && wasKeyboard && Math.abs(kbInset - prevInset) > 8;
        if (
          (keyboardJustOpened || insetChangedWhileOpen) &&
          shouldStickToBottomRef.current &&
          !userScrollLockRef.current
        ) {
          const mc = messagesContainerRef.current;
          if (mc) {
            snapThreadToBottom(mc, virtualThreadRef, {
              min: true,
              followUpFrame: false,
              canSnap: () => !userScrollLockRef.current && shouldStickToBottomRef.current,
            });
          }
        }
      } else {
        setViewportCssVars({
          "--wa-keyboard-inset": null,
          "--wa-visual-height": null,
          "--wa-composer-stack-h": stackH != null ? `${stackH}px` : null,
        });
        shell.classList.remove("wa-keyboard-visible");
        mobileKeyboardWasVisibleRef.current = false;
      }
    };

    const syncTimers = new Set();
    const scheduleTimer = (delay) => {
      const id = window.setTimeout(() => {
        syncTimers.delete(id);
        syncHeaderLayout();
      }, delay);
      syncTimers.add(id);
    };
    const scheduleSyncHeaderLayout = () => {
      syncHeaderLayout();
      window.requestAnimationFrame?.(syncHeaderLayout);
      scheduleTimer(80);
      scheduleTimer(220);
      scheduleTimer(420);
    };

    scheduleSyncHeaderLayout();

    const ro = new ResizeObserver(syncHeaderLayout);
    ro.observe(header);
    const composerStack = shell.querySelector(".wa-composerStack");
    const composerRo = composerStack ? new ResizeObserver(syncHeaderLayout) : null;
    composerRo?.observe(composerStack);

    const onMqChange = () => scheduleSyncHeaderLayout();
    if (mq.addEventListener) mq.addEventListener("change", onMqChange);
    else mq.addListener(onMqChange);

    // visualViewport resize/scroll dispara em rajada contínua durante a animação
    // do teclado — coalesce para 1 sync por frame + 1 sync de assentamento no fim,
    // em vez do burst completo (sync + rAF + 3 timers) a cada evento.
    const vv = window.visualViewport;
    let vvRafId = 0;
    let vvSettleTimer = 0;
    const onVv = () => {
      if (!vvRafId) {
        vvRafId = window.requestAnimationFrame(() => {
          vvRafId = 0;
          syncHeaderLayout();
        });
      }
      window.clearTimeout(vvSettleTimer);
      vvSettleTimer = window.setTimeout(syncHeaderLayout, 140);
    };
    if (vv) {
      vv.addEventListener("resize", onVv);
      vv.addEventListener("scroll", onVv);
    }

    const onInputFocusBlur = () => scheduleSyncHeaderLayout();
    document.addEventListener("focusin", onInputFocusBlur);
    document.addEventListener("focusout", onInputFocusBlur);

    return () => {
      ro.disconnect();
      composerRo?.disconnect();
      if (mq.removeEventListener) mq.removeEventListener("change", onMqChange);
      else mq.removeListener(onMqChange);
      if (vv) {
        vv.removeEventListener("resize", onVv);
        vv.removeEventListener("scroll", onVv);
      }
      if (vvRafId) window.cancelAnimationFrame(vvRafId);
      window.clearTimeout(vvSettleTimer);
      document.removeEventListener("focusin", onInputFocusBlur);
      document.removeEventListener("focusout", onInputFocusBlur);
      syncTimers.forEach((id) => window.clearTimeout(id));
      syncTimers.clear();
      shell.classList.remove("wa-keyboard-visible");
      mobileKeyboardWasVisibleRef.current = false;
      document.documentElement.style.removeProperty("--wa-mobile-header-h");
      document.documentElement.style.removeProperty("--wa-vv-top");
      document.documentElement.style.removeProperty("--wa-keyboard-inset");
      document.documentElement.style.removeProperty("--wa-visual-height");
      document.documentElement.style.removeProperty("--wa-composer-stack-h");
      shell.style.removeProperty("--wa-mobile-header-h");
      shell.style.removeProperty("--wa-vv-top");
      shell.style.removeProperty("--wa-keyboard-inset");
      shell.style.removeProperty("--wa-visual-height");
      shell.style.removeProperty("--wa-composer-stack-h");
    };
  }, [conversaId]);
}
