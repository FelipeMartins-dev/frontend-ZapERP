/**
 * Regressão: fotos de clientes não podem sumir em refresh parcial e caminhos
 * relativos de avatar precisam ser renderizáveis pelo frontend.
 */
import {
  getContactDisplay,
  pickPreferredAvatarUrl,
  resolveAvatarUrl,
} from "../src/chats/chatListDisplay.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const apiBase = "https://api.teste.local";

assert(
  resolveAvatarUrl("/uploads/perfis/cliente.jpg") === `${apiBase}/uploads/perfis/cliente.jpg`,
  "avatar relativo à raiz deve usar o host atual da API"
);
assert(
  resolveAvatarUrl("uploads/perfis/cliente.jpg") === `${apiBase}/uploads/perfis/cliente.jpg`,
  "avatar relativo sem barra deve usar o host atual da API"
);
assert(
  getContactDisplay({ contato_nome: "Cliente", foto_perfil_contato_cache: "/uploads/cache.jpg" }).avatarUrl ===
    `${apiBase}/uploads/cache.jpg`,
  "cache de foto relativo deve aparecer no card"
);

const antiga = { contato_nome: "Cliente", foto_perfil: "https://cdn.example/cliente.jpg" };
const refreshParcial = { contato_nome: "Cliente", foto_perfil: null };
assert(
  pickPreferredAvatarUrl(refreshParcial, antiga) === antiga.foto_perfil,
  "refresh parcial com null não pode apagar foto válida já carregada"
);

const atualizada = { contato_nome: "Cliente", foto_perfil: "https://cdn.example/nova.jpg" };
assert(
  pickPreferredAvatarUrl(atualizada, antiga) === atualizada.foto_perfil,
  "foto nova da API deve prevalecer sobre o cache anterior"
);

console.log("OK - regressão de fotos e URLs de mídia passou (5 cenários).");
