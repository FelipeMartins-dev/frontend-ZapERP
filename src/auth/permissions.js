import { usePermissoesStore } from "./permissoesStore";

function role(user) {
  return String(user?.role || user?.perfil || "").toLowerCase();
}

export function isSupervisorOrAdmin(user) {
  const userRole = role(user);
  return userRole === "admin" || userRole === "administrador" || userRole === "supervisor";
}

/** Mapa codigo -> função de check por role (fallback quando API não retornou) */
const CODIGO_TO_ROLE_CHECK = {
  dashboard_acessar: (u) => ["supervisor", "admin"].includes(role(u)),
  config_acessar: (u) => ["supervisor", "admin"].includes(role(u)),
  usuarios_acessar: (u) => role(u) === "admin",
  chatbot_acessar: (u) => ["supervisor", "admin"].includes(role(u)),
  departamentos_gerenciar: (u) => role(u) === "admin",
};

/**
 * Verifica permissão por código. Prioriza resultado da API (GET /usuarios/me/permissoes),
 * senão usa fallback por role para codigos conhecidos.
 * @param {string} codigo - Ex: "dashboard_acessar", "config_acessar"
 * @param {object} user - Usuário (useAuthStore.user)
 * @returns {boolean}
 */
export function can(codigo, user) {
  if (!codigo) return false;
  const permissoes = usePermissoesStore.getState().permissoes;
  if (permissoes != null && Object.prototype.hasOwnProperty.call(permissoes, codigo)) {
    return !!permissoes[codigo];
  }
  const fn = CODIGO_TO_ROLE_CHECK[codigo];
  return fn ? fn(user) : false;
}

/** Admin, supervisor e atendente podem assumir conversas da fila */
export function canAssumir(user) {
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Admin, supervisor e atendente podem transferir (atendente só a conversa que está atendendo) */
export function canTransferir(user) {
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Admin, supervisor e atendente podem encerrar (quando for sua conversa) */
export function canEncerrar(user) {
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Admin, supervisor e atendente podem reabrir */
export function canReabrir(user) {
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Admin, supervisor e atendente podem puxar conversa da fila */
export function canPuxarFila(user) {
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Admin, supervisor e atendente podem gerenciar tags da conversa */
export function canTag(user) {
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Admin, supervisor e atendente podem gerenciar respostas salvas pessoais */
export function canGerenciarRespostasSalvas(user) {
  const permissoes = usePermissoesStore.getState().permissoes;
  if (permissoes != null && Object.prototype.hasOwnProperty.call(permissoes, "atendimentos.respostas_salvas")) {
    return !!permissoes["atendimentos.respostas_salvas"];
  }
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Supervisor e admin podem acessar Configurações (usa can() para priorizar API) */
export function canAcessarConfiguracoes(user) {
  return can("config_acessar", user);
}

/** Apenas admin: acessar e gerenciar Usuários (usa can() para priorizar API) */
export function canAcessarUsuarios(user) {
  return can("usuarios_acessar", user);
}

/** Apenas admin: definir e editar setores (departamentos) em Configurações */
export function canGerenciarSetores(user) {
  return can("departamentos_gerenciar", user) || role(user) === "admin";
}

/** Admin, supervisor e atendente podem transferir setor da conversa */
export function canTransferirSetorConversa(user) {
  return ["admin", "supervisor", "atendente"].includes(role(user));
}

/** Supervisor e admin podem acessar Dashboard (usa can() para priorizar API) */
export function canAcessarDashboard(user) {
  return can("dashboard_acessar", user);
}

/** Supervisor e admin podem acessar Chatbot (IA/Bot) (usa can() para priorizar API) */
export function canAcessarChatbot(user) {
  return can("chatbot_acessar", user);
}

/** Admin, supervisor e atendente podem criar notas internas (invisíveis ao cliente) */
export function canNotaInterna(user) {
  const permissoes = usePermissoesStore.getState().permissoes;
  if (permissoes != null && Object.prototype.hasOwnProperty.call(permissoes, "atendimentos.nota_interna")) {
    return !!permissoes["atendimentos.nota_interna"];
  }
  return ["admin", "supervisor", "atendente"].includes(role(user));
}
