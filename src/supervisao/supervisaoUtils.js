export const NIVEL_ORDER = {
  critico: 0,
  prioritario: 1,
  atencao: 2,
  normal: 3,
};

export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toArray(data, fallbackKeys = []) {
  if (Array.isArray(data)) return data;
  for (let i = 0; i < fallbackKeys.length; i += 1) {
    const val = data?.[fallbackKeys[i]];
    if (Array.isArray(val)) return val;
  }
  return [];
}

export function formatTempoMinutos(mins) {
  const total = Math.max(0, Math.floor(toNumber(mins, 0)));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h`;
}

/** Tempo médio vindo da API (minutos, pode ser decimal). Null/NaN → traço. */
export function formatTempoMedioRespostaMinutos(mins) {
  if (mins == null || mins === "") return "—";
  const n = Number(mins);
  if (!Number.isFinite(n)) return "—";
  if (n < 60) {
    const rounded = Math.round(n * 10) / 10;
    return `${rounded} min`;
  }
  const h = Math.floor(n / 60);
  return `${h} h`;
}

/** Quantidade de conversas com status `em_atendimento` para o funcionário (API supervisão). */
export function pickConversasEmAtendimento(funcionario) {
  return toNumber(
    funcionario?.conversas_em_atendimento ?? funcionario?.conversasEmAtendimento ?? 0,
    0
  );
}

/** Finalizações no dia (eventos `encerrou` com `de_usuario_id` = atendente). */
export function pickFinalizadasHoje(funcionario) {
  return toNumber(
    funcionario?.finalizadas_hoje ??
      funcionario?.atendimentos_finalizados_hoje ??
      funcionario?.atendimentosFinalizadosHoje ??
      0,
    0
  );
}

/**
 * Evita React error #31 ao renderizar valores que podem vir como objeto da API.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeDisplayText(value, fallback = "") {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) {
    const joined = value
      .map((v) => safeDisplayText(v, ""))
      .filter(Boolean)
      .join(", ");
    return joined || fallback;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const nested =
      value.nome ??
      value.name ??
      value.label ??
      value.titulo ??
      value.departamento_nome ??
      value.departamentoNome;
    if (nested != null && typeof nested !== "object") {
      return String(nested);
    }
    const id = value.departamento_id ?? value.id ?? value.departamentoId;
    if (id != null) return `Departamento #${id}`;
  }
  return fallback;
}

/** Nome legível de departamento (string, objeto aninhado ou legado). */
export function resolveDepartamentoNome(raw) {
  return safeDisplayText(raw, "") || "Sem departamento";
}

export function normalizeNivel(rawNivel, minutosAguardando, slaMinutos = 30) {
  const nivel = String(rawNivel || "").trim().toLowerCase();
  if (nivel === "normal" || nivel === "atencao" || nivel === "prioritario" || nivel === "critico") {
    return nivel;
  }
  const mins = toNumber(minutosAguardando, 0);
  const sla = Math.max(5, toNumber(slaMinutos, 30));
  if (mins >= sla) return "critico";
  if (mins >= Math.floor(sla * 0.85)) return "prioritario";
  if (mins >= Math.floor(sla * 0.65)) return "atencao";
  return "normal";
}

export function normalizePendente(item, slaMinutos = 30) {
  const minutosAguardando = toNumber(
    item?.minutos_aguardando ??
      item?.tempo_aguardando_minutos ??
      item?.tempoAguardandoMinutos ??
      item?.tempo_espera_minutos ??
      item?.minutes_waiting ??
      0
  );
  const nivel = normalizeNivel(item?.nivel, minutosAguardando, slaMinutos);
  const resumoRaw =
    item?.resumo_conversa ??
    item?.ultima_mensagem_resumo ??
    item?.ultimaMensagemResumo ??
    item?.ultima_mensagem ??
    "";
  return {
    ...item,
    minutosAguardando,
    nivel,
    resumoConversa: safeDisplayText(resumoRaw, "Sem resumo de mensagem") || "Sem resumo de mensagem",
    ultimaMensagemEm: item?.ultima_mensagem_em ?? item?.ultimaMensagemEm ?? item?.updated_at ?? null,
    conversaId: item?.conversa_id ?? item?.conversaId ?? item?.id ?? null,
    clienteNome: safeDisplayText(item?.cliente_nome ?? item?.cliente?.nome, "Cliente sem nome"),
    telefone: safeDisplayText(item?.telefone ?? item?.cliente_telefone, "-"),
    funcionarioNome: safeDisplayText(item?.funcionario_nome ?? item?.responsavel_nome, "Sem responsável"),
    departamentoNome: resolveDepartamentoNome(
      item?.departamento ?? item?.departamento_nome ?? item?.setor ?? item?.departamentos
    ),
  };
}

export function sortPendentes(list = []) {
  return [...list].sort((a, b) => {
    const pA = NIVEL_ORDER[a?.nivel] ?? 99;
    const pB = NIVEL_ORDER[b?.nivel] ?? 99;
    if (pA !== pB) return pA - pB;
    return toNumber(b?.minutosAguardando, 0) - toNumber(a?.minutosAguardando, 0);
  });
}

export function toIsoDate(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
