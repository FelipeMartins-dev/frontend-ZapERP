# Certificação + Hardening WhatsApp Web-like (Z-API) — Frontend

## Resumo das alterações

### A) Socket — Join idempotente e dedupe de listeners

**Arquivos:** `src/socket/socket.js`, `src/conversa/conversaStore.js`

- **`leaveConversa(id)`** e **`joinConversaIfNeeded(id)`**: helpers exportados para join/leave idempotente
- **`currentConversationId`**: ref interna que evita emitir `join_conversa` mais de uma vez na mesma conversa
- **`carregarConversa`**: usa `leaveConversa`/`joinConversaIfNeeded` em vez de `socket.emit` direto
- **Removido join duplicado** que ocorria após o fetch (linhas 156–158 antigas)
- **Logout**: limpa `chatStore` e `conversaStore` antes de redirecionar

### B) Eventos em tempo real

**Arquivo:** `src/socket/socket.js`

- **status_mensagem**: mapeamento de `played`/`reproduzida` → `played`
- **status_mensagem**: prioriza `whatsapp_id` (passa `null` como `mensagemId` quando `whatsapp_id` existe)
- **nova_mensagem**: `fromMe` sem `direcao` → define `direcao: "out"`
- **atualizar_conversa**: debounce de 400ms para evitar fetches repetidos

### C) Dedupe total

**Arquivos:** `src/conversa/conversaStore.js`, `src/chats/chatsStore.js`

**Mensagens:**
- `anexarMensagem`: aceita msg só com `whatsapp_id` ou `tempId` (espelhadas / optimistic)
- Chave única: `whatsapp_id` > `id` > `tempId`
- `reconciliarMensagem(tempId, realMsg)`: troca mensagem temp pela real
- `removerMensagemTemp(tempId)`: remove em caso de falha no envio
- `patchMensagem`: localiza por `tempId` quando aplicável

**Conversas:**
- `dedupeConversas(list)`: remove duplicatas por `telefone | canonicalPhone | chat_lid`
- Critério de escolha: preferir conversa com telefone (não lid), `ultima_atividade` maior, nome/foto preenchidos
- `setChats` e `addChat` usam `dedupeConversas`

### D) Nome, foto e telefone (fallbacks)

**Arquivos:** `src/chats/chatList.jsx`, `src/conversa/ConversaView.jsx`

**Lista e header do chat:**
- **Nome:** `cliente.nome` || `nome_contato_cache` || `nome_grupo` || `pushname` || `formatPhone(telefone)`
- **Foto:** `foto_perfil` || `foto_perfil_contato_cache` || `foto_grupo` || avatar padrão
- **Telefone:** formatação BR, ex.: `(11) 98765-4321`
- Nunca exibir "Sem conversa" quando houver qualquer fallback

### E) Optimistic UI + status

**Arquivos:** `src/conversa/ConversaView.jsx`, `src/conversa/conversaStore.js`

1. Ao enviar: mensagem OUT inserida imediatamente com `status: 'pending'` e `tempId`
2. Chamada da API `enviarMensagem`
3. Ao retornar `whatsapp_id`: `reconciliarMensagem(tempId, res.mensagem)`
4. Em `status_mensagem`: ticks atualizados por `whatsapp_id`
5. Se envio falhar: remove temp e restaura texto/reply na UI

### F) Botão "Sincronizar contatos"

**Arquivo:** `src/chats/chatList.jsx`

- Botão no header da lista (ícone de usuários)
- Chama `POST /chats/sincronizar-contatos`
- Estados de loading: spinner no botão
- Toast com resultado: `inserted`, `updated`, `total`
- Tratamento de erros: 401 → login, 409 `needsRestore` → Configurações, 502 → toast de falha
- Após sucesso: `load()` para atualizar a lista

---

## Checklist de certificação (PASS/FAIL)

| # | Teste | Evidência |
|---|-------|-----------|
| 1 | Company 1 e 2: mensagem externa aparece em tempo real no chat aberto | Network: evento `nova_mensagem`; Console: sem duplicatas |
| 2 | Enviar pelo CRM: mensagem aparece na hora e os ticks mudam sem refresh | UI: pending → sent → delivered/read; sem reload |
| 3 | De-dup: 3 mensagens rápidas não duplicam na UI | Visual: uma mensagem por envio; Console: sem logs de duplicação |
| 4 | Socket: sem joins/listeners duplicados | Console: não repetir "join_conversa" ao trocar conversa ou reconectar |
| 5 | Dados: 10 contatos com nome/foto/telefone corretos | Visual: lista e header sem "Sem conversa" onde houver fallback |
| 6 | Sync: botão retorna OK e atualiza lista | Clique em "Sincronizar contatos" → toast de sucesso → lista atualizada |

---

## Como validar

1. **Console (DevTools):** abrir e checar se não há vários `join_conversa` ou listeners duplicados.
2. **Network:** filtro WS para ver eventos `nova_mensagem`, `status_mensagem`.
3. **Visual:** enviar mensagem e conferir se aparece imediatamente com ✓ e depois ✓✓.
4. **De-dup:** enviar 3 mensagens em sequência rápida e verificar ausência de duplicatas.

---

## Garantia de regressão

- Nenhuma alteração quebre o fluxo da Company 1.
- Endpoints e payloads mantidos.
- Lógica nova isolada e compatível com o fluxo existente.
