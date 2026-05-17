/**
 * Melhorias visuais ZapERP — somente DOM (sem alterar fontes de dados).
 */

const WAIT_SELECTOR = ".chat-list-time-espera-min, .zap-wait-time";
const COUNTER_SELECTOR = ".zap-counter-target";

function parseWaitMinutes(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const hud = t.match(/•\s*(\d+)\s*m/i);
  if (hud) return Number(hud[1]);
  const plain = t.match(/(\d+)\s*m(?:in)?/i);
  if (plain) return Number(plain[1]);
  if (/<\s*1/i.test(t) && /m|min/i.test(t)) return 0;
  return null;
}

function waitLevelForMinutes(mins) {
  if (mins == null || !Number.isFinite(mins)) return null;
  if (mins < 5) return "low";
  if (mins <= 15) return "mid";
  return "high";
}

export function applyWaitLevelToElement(el) {
  if (!el || !(el instanceof Element)) return;
  const mins = parseWaitMinutes(el.textContent);
  const level = waitLevelForMinutes(mins);
  if (level) el.setAttribute("data-wait-level", level);
  else el.removeAttribute("data-wait-level");
}

function scanWaitTimes(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll(WAIT_SELECTOR).forEach(applyWaitLevelToElement);
}

function triggerCounterBump(el) {
  if (!el) return;
  el.classList.remove("zap-counter-bump");
  void el.offsetWidth;
  el.classList.add("zap-counter-bump");
  const onEnd = () => {
    el.classList.remove("zap-counter-bump");
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
}

function observeCounter(el) {
  if (!el || el.dataset.zapCounterObserved === "1") return;
  el.dataset.zapCounterObserved = "1";
  let prev = el.textContent;
  const obs = new MutationObserver(() => {
    const next = el.textContent;
    if (next !== prev) {
      prev = next;
      triggerCounterBump(el);
    }
  });
  obs.observe(el, { childList: true, characterData: true, subtree: true });
}

function observeCounters(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll(COUNTER_SELECTOR).forEach(observeCounter);
}

/** Busca: ChatListSearchBox já usa debounce React (280ms) — não interceptar input. */
function verifySearchDebounce() {
  const busca = document.querySelector("[data-search]");
  if (busca && busca.dataset.debouncedAttached !== "true") {
    /* Sem elemento data-search no DOM atual; debounce já existe no componente dedicado. */
  }
}

let listObserver = null;
let listScanTimer = null;

function scheduleListWaitScan(listEl) {
  if (!listEl) return;
  if (listScanTimer) window.clearTimeout(listScanTimer);
  listScanTimer = window.setTimeout(() => {
    listScanTimer = null;
    scanWaitTimes(listEl);
  }, 120);
}

/**
 * @param {HTMLElement | Document} [root]
 * @returns {() => void} cleanup
 */
export function initZapDomEnhancements(root = document) {
  const scope = root?.querySelector ? root : document;
  scanWaitTimes(scope);
  observeCounters(scope);
  verifySearchDebounce();

  if (listObserver) listObserver.disconnect();
  if (listScanTimer) {
    window.clearTimeout(listScanTimer);
    listScanTimer = null;
  }
  const listEl = scope.querySelector?.(".chat-list-list") || document.querySelector(".chat-list-list");
  if (listEl) {
    listObserver = new MutationObserver(() => {
      scheduleListWaitScan(listEl);
    });
    listObserver.observe(listEl, { childList: true, subtree: true });
  }

  return () => {
    listObserver?.disconnect();
    listObserver = null;
    if (listScanTimer) {
      window.clearTimeout(listScanTimer);
      listScanTimer = null;
    }
  };
}
