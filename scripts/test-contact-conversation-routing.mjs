/**
 * Regressão do botão "Conversar" em cartões de contato compartilhado.
 */
import api from "../src/api/http.js";
import {
  abrirConversaPorTelefone,
  buildTelefoneVariantsForContato,
  resolveWhatsappInstanceIdForSharedContact,
} from "../src/chats/chatService.js";

let falhas = 0;
function checar(nome, condicao, detalhe = "") {
  if (condicao) return;
  falhas += 1;
  console.error(`FALHOU: ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

{
  const id = resolveWhatsappInstanceIdForSharedContact(
    { whatsapp_instance_id: 22 },
    { whatsapp_instance_id: 11 },
    null
  );
  checar("instância da própria mensagem tem prioridade", id === 22, String(id));
}

{
  const id = resolveWhatsappInstanceIdForSharedContact(
    {},
    { whatsapp_instance_id: "11" },
    null
  );
  checar("conversa atual fornece a instância como fallback", id === 11, String(id));
}

{
  const variants = buildTelefoneVariantsForContato("(34) 99999-9999");
  checar("telefone BR gera variante com DDI", variants.includes("5534999999999"), JSON.stringify(variants));
}

const originalGet = api.get;
const originalPost = api.post;
let posts = 0;
try {
  api.get = async () => ({
    data: [
      { id: 101, telefone: "5534999999999", whatsapp_instance_id: 11 },
      { id: 202, telefone: "5534999999999", whatsapp_instance_id: 22 },
    ],
    headers: {},
  });
  api.post = async () => {
    posts += 1;
    throw new Error("não deveria criar contato quando a conversa correta já existe");
  };

  const result = await abrirConversaPorTelefone(
    "Contato compartilhado",
    "5534999999999",
    22
  );
  checar("abre a conversa da instância correta", result?.conversa?.id === 202, JSON.stringify(result));
  checar("não cria conversa duplicada", posts === 0, String(posts));
} finally {
  api.get = originalGet;
  api.post = originalPost;
}

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.`);
  process.exit(1);
}

console.log("OK — cartão de contato abre a conversa correta e preserva a instância WhatsApp.");
