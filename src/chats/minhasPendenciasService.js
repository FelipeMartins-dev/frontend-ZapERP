import api from "../api/http";

export const PENDENCIA_CATEGORIAS = {
  transferidosParaVoce: "transferidosParaVoce",
  aguardandoSuaResposta: "aguardandoSuaResposta",
  emAtraso: "emAtraso",
};

const EMPTY_RESUMO = {
  transferidosParaVoce: 0,
  aguardandoSuaResposta: 0,
  emAtraso: 0,
};

function normalizeResumo(data) {
  if (!data || typeof data !== "object") return { ...EMPTY_RESUMO };
  return {
    transferidosParaVoce: Number(data.transferidosParaVoce) || 0,
    aguardandoSuaResposta: Number(data.aguardandoSuaResposta) || 0,
    emAtraso: Number(data.emAtraso) || 0,
  };
}

function normalizeConversaIds(data) {
  if (!data || typeof data !== "object") return [];
  const raw = data.conversa_ids ?? data.conversaIds ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id)).filter(Boolean);
}

/** GET /conversas/minhas-pendencias — contadores do atendente logado */
export async function fetchMinhasPendenciasResumo() {
  const { data } = await api.get("/conversas/minhas-pendencias");
  return normalizeResumo(data);
}

/** GET /conversas/minhas-pendencias?categoria=... — ids da categoria */
export async function fetchMinhasPendenciasCategoria(categoria) {
  const key = String(categoria || "").trim();
  const { data } = await api.get("/conversas/minhas-pendencias", {
    params: { categoria: key },
  });
  return {
    categoria: data?.categoria ?? key,
    total: Number(data?.total) || 0,
    conversa_ids: normalizeConversaIds(data),
  };
}
