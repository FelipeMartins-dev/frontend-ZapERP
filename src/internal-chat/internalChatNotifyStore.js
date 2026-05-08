import { create } from "zustand";

function sumByConv(byConv) {
  let n = 0;
  const o = byConv || {};
  for (const k of Object.keys(o)) {
    n += Number(o[k]) || 0;
  }
  return n;
}

/**
 * Não lidos do chat interno para badge na sidebar e título global.
 * Hidratação via API / lista na página; incremento via socket quando fora da rota.
 */
export const useInternalChatNotifyStore = create((set, get) => ({
  byConv: {},

  getTotal: () => sumByConv(get().byConv),

  reset: () => set({ byConv: {} }),

  /** Substitui contagens pelas vindas do backend (lista de conversas normalizada). */
  hydrateFromConversations(conversations) {
    const byConv = {};
    for (const c of conversations || []) {
      if (c?.id == null || c.id === "") continue;
      byConv[String(c.id)] = Math.max(0, Number(c.unreadCount) || 0);
    }
    set({ byConv });
  },

  bumpConv(convId, delta = 1) {
    const id = String(convId);
    if (!id) return;
    const d = Math.max(1, Number(delta) || 1);
    const prev = get().byConv[id] || 0;
    set({ byConv: { ...get().byConv, [id]: prev + d } });
  },

  setConvUnread(convId, n) {
    const id = String(convId);
    if (!id) return;
    const v = Math.max(0, Number(n) || 0);
    const next = { ...get().byConv, [id]: v };
    set({ byConv: next });
  },
}));

/** Seletor para evitar re-renders desnecessários quando o total não muda. */
export function selectInternalChatUnreadTotal(state) {
  return sumByConv(state.byConv);
}
