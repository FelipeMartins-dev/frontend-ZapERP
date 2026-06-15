# Relatório de Validação: Integração Frontend ↔ Backend

**Data:** 06/03/2025  
**Checklist:** Configuração base, Autenticação, Dashboard, Chats, Clientes/Usuários/Tags, IA, Z-API, WebSocket, Fluxos críticos, Tratamento de erros.

---

## Configuração base

| Item | Status | Detalhes |
|------|--------|----------|
| Base URL configurável | ✅ | `VITE_API_URL` em `.env`; fallback: `https://zaperpapi.wmsistemas.inf.br` |
| Frontend NÃO adiciona /api na maioria das rotas | ✅ | Rotas usam caminho exato (ex: `/usuarios/login`, `/chats`, `/dashboard/overview`) |
| Exceções com /api | ✅ | `POST /api/ai/ask`, `GET/POST /api/integrations/zapi/connect/*` |

---

## 1. Autenticação

| Item | Status | Local | Observação |
|------|--------|-------|------------|
| POST /usuarios/login com { email, senha } | ✅ | `authService.js` | Retorno esperado: `{ token, usuario }` ou `{ token, user }` |
| Token salvo e enviado em Authorization: Bearer | ✅ | `http.js` interceptor | Lê `zap_erp_auth` do localStorage, injeta em todas as requisições |
| 401 redireciona para login | ✅ | `http.js` interceptor | Remove auth, desconecta socket, `window.location.href = "/login"` |
| 403 exibido quando sem permissão | ❌ | — | **FALTA:** Não há tratamento global no interceptor |

**Ajuste sugerido (frontend):** Adicionar no interceptor de `http.js`:
```js
else if (status === 403) {
  show({ type: "error", title: "Sem permissão", message: err?.response?.data?.error || "Você não tem permissão para esta ação." })
}
```

**authStore:** Usa `data.usuario`; se o backend retornar `user`, considerar `data.usuario || data.user` para compatibilidade.

---

## 2. Dashboard

| Item | Status | Local |
|------|--------|-------|
| GET /dashboard/overview | ✅ | `dashboardService.js` — params: `range_days` |
| GET /dashboard/departamentos | ✅ | `dashboardService.js`, `configService.js`, `chatList.jsx`, `ConversaView.jsx` |
| GET /dashboard/respostas-salvas | ✅ | `dashboardService.js` — params: `departamento_id` |
| POST /dashboard/respostas-salvas | ✅ | `dashboardService.js` |
| GET /dashboard/relatorios/conversas | ✅ | `dashboardService.js` |
| GET /dashboard/relatorios/mensagens | ✅ | `dashboardService.js` |
| GET /dashboard/relatorios/export?format=csv\|xlsx\|pdf | ✅ | `dashboardService.js` — `format` no params |
| GET /dashboard/sla/config | ✅ | `dashboardService.js` |
| PUT /dashboard/sla/config | ✅ | `dashboardService.js` — body: `{ sla_minutos_sem_resposta }` |
| GET /dashboard/sla/alertas | ✅ | `dashboardService.js` |

---

## 3. Chats

| Item | Status | Local |
|------|--------|-------|
| GET /chats (filtros) | ✅ | `chatService.js` — tag_id, departamento_id, data_inicio, data_fim, status_atendimento, atendente_id, palavra, incluir_todos_clientes |
| GET /chats/:id | ✅ | `chatService.js`, `conversaService.js` |
| POST /chats/:id/mensagens { texto } | ✅ | `chatService.js`, `conversaService.js` (+ reply_meta, link) |
| POST /chats/:id/arquivo FormData "file" | ✅ | `ConversaView.jsx` |
| POST /chats/:id/tags { tag_id } | ✅ | `chatService.js`, `tagService.js`, `conversaService.js` |
| DELETE /chats/:id/tags/:tag_id | ✅ | `chatService.js`, `tagService.js`, `conversaService.js` |
| PUT /chats/:id/observacao | ✅ | `conversaService.js` |
| PUT /chats/:id/cliente ou /vincular-cliente | ✅ | `conversaService.js` — tenta ambos, body: `{ cliente_id }` |
| POST /chats/:id/assumir | ✅ | `conversaService.js`, `atendimentoService.js` |
| POST /chats/:id/encerrar | ✅ | `conversaService.js`, `atendimentoService.js` |
| POST /chats/:id/reabrir | ✅ | `conversaService.js` |
| POST /chats/:id/transferir | ✅ | `conversaService.js` — body: `{ para_usuario_id, observacao }` |
| GET /chats/:id/atendimentos | ✅ | `conversaService.js` |
| POST /chats/puxar | ✅ | `conversaService.js` |
| POST /chats/:id/contatos | ✅ | `conversaService.js` — body: `{ cliente_id, messageId? }` |
| POST /chats/:id/ligacao | ✅ | `conversaService.js` — body: `{ callDuration? }` |
| POST /chats/:id/mensagens/:id/reacao | ✅ | `conversaService.js` — body: `{ reaction }` |
| DELETE /chats/:id/mensagens/:id | ✅ | `conversaService.js` — params: `scope?` |
| DELETE /chats/:id/mensagens/:id/reacao | ✅ | `conversaService.js` |
| POST /chats/grupos { nome } | ✅ | `chatService.js` |
| POST /chats/comunidades { nome } | ✅ | `chatService.js` |
| POST /chats/contato { nome, telefone } | ✅ | `chatService.js` |
| POST /chats/abrir-conversa { cliente_id } | ✅ | `chatService.js` |
| POST /chats/sincronizar-contatos | ✅ | `chatService.js` |
| POST /chats/sincronizar-fotos-perfil | ✅ | `chatService.js` |
| GET /chats/zapi-status | ✅ | `chatService.js` |
| PUT /chats/:id/departamento | ✅ | `ConversaView.jsx` — body: `{ departamento_id }` |

---

## 4. Clientes, Usuários, Tags

| Item | Status | Local |
|------|--------|-------|
| GET/POST/PUT/DELETE /clientes | ✅ | `configService.js` |
| GET /clientes/:id | ✅ | `configService.js` |
| GET/POST/PUT/DELETE /usuarios | ✅ | `configService.js` |
| POST /usuarios/:id/redefinir-senha | ✅ | `configService.js` |
| GET/POST/PUT/DELETE /tags | ✅ | `configService.js`, `tagService.js` |
| POST /tags body: { nome, cor } | ✅ | `tagService.js`, `configService.js` |

---

## 5. IA (regras e config)

| Item | Status | Local |
|------|--------|-------|
| GET/PUT /ia/config | ✅ | `iaService.js` |
| GET/POST/PUT/DELETE /ia/regras | ✅ | `iaService.js` |
| GET /ia/logs | ✅ | `iaService.js` — params: `limit` |

---

## 6. IA Assistente (rota com /api)

| Item | Status | Local |
|------|--------|-------|
| POST /api/ai/ask { question } | ✅ | `DashboardIA.jsx` |
| Resposta: answer / response / message | ✅ | `DashboardIA.jsx` — aceita `data.answer`, `data.response`, `data.message` |

---

## 7. Z-API Connect (rotas com /api)

| Item | Status | Local |
|------|--------|-------|
| GET /api/integrations/zapi/connect/status | ✅ | `zapiIntegration.js` |
| POST /api/integrations/zapi/connect/qrcode | ✅ | `zapiIntegration.js` |
| POST /api/integrations/zapi/connect/restart | ✅ | `zapiIntegration.js` |
| POST /api/integrations/zapi/connect/phone-code { phone } | ✅ | `zapiIntegration.js` |

---

## 8. WebSocket (Socket.IO)

| Item | Status | Local |
|------|--------|-------|
| Conexão na mesma base da API | ✅ | `socket.js` — `io(getApiBaseUrl(), ...)` |
| Autenticação: auth: { token } | ✅ | `socket.js` |
| Emite: join_conversa, leave_conversa, typing_start, typing_stop | ✅ | `socket.js`, `ConversaView.jsx` |
| Emite: marcar_conversa_lida | ✅ | `conversaStore.js` |
| Escuta: nova_mensagem, conversa_atualizada, typing_start, typing_stop | ✅ | `socket.js` |
| Escuta: tag_adicionada, tag_removida, nova_conversa | ✅ | `socket.js` |
| Escuta: mensagem_excluida, mensagem_oculta, status_mensagem, mensagens_lidas | ✅ | `socket.js` |
| Escuta: zapi_sync_contatos, conversa_encerrada, conversa_transferida, conversa_reaberta, conversa_atribuida | ✅ | `socket.js` |
| Escuta: atualizar_conversa, contato_atualizado | ✅ | `socket.js` |

---

## 9. Fluxos críticos (teste manual)

| Fluxo | Implementado no frontend | Requer backend ativo |
|-------|--------------------------|----------------------|
| Login → token → lista de chats carrega | ✅ | Sim |
| Abrir chat → mensagens carregam → enviar mensagem → aparece em tempo real | ✅ | Sim |
| Nova mensagem do WhatsApp → aparece na lista e no chat (WebSocket) | ✅ | Sim |
| Assumir conversa → encerrar → reabrir | ✅ | Sim |
| Adicionar/remover tag na conversa | ✅ | Sim |
| Conectar WhatsApp (QR Code ou phone-code) → status atualiza | ✅ | Sim |
| Exportar relatório (CSV/XLSX/PDF) | ✅ | Sim |
| Assistente IA: pergunta → resposta exibida | ✅ | Sim |

**Nota:** Os fluxos estão implementados no frontend. A validação end-to-end depende do backend estar rodando e expondo as rotas corretas.

---

## 10. Tratamento de erros

| Status | Status | Local |
|--------|--------|-------|
| 401 → redireciona para login | ✅ | `http.js` interceptor |
| 403 → mensagem de permissão negada | ❌ | **FALTA** |
| 429 → mensagem de rate limit | ✅ | `http.js` interceptor |
| 500 → mensagem genérica de erro | ✅ | `http.js` interceptor |

---

## Resumo: o que passou, o que falhou, o que ajustar

### ✅ Passou (frontend pronto)

- Configuração base (Base URL, rotas sem /api, exceções com /api)
- Autenticação (login, token, 401, logout)
- Dashboard (todas as rotas)
- Chats (todas as rotas)
- Clientes, Usuários, Tags (CRUD completo)
- IA (config, regras, logs)
- IA Assistente (/api/ai/ask)
- Z-API Connect (status, qrcode, restart, phone-code)
- WebSocket (conexão, auth, emit, listen)
- Fluxos críticos (implementados)
- Tratamento de erros: 401, 429, 500, Network

### ❌ Falhou / precisa ajuste

| Item | Onde ajustar | Ação |
|------|--------------|------|
| 403 sem mensagem de permissão | Frontend `http.js` | Adicionar tratamento no interceptor de resposta |
| Login com `user` em vez de `usuario` | Frontend `authStore.js` | Opcional: `data.usuario \|\| data.user` |

### ⚠️ Depende do backend

- Todas as rotas devem existir e retornar o formato esperado
- WebSocket deve emitir os eventos listados
- CORS configurado para a origem do frontend

---

## Conclusão

O frontend está **integrado corretamente** com o contrato esperado do backend. O único ajuste recomendado no frontend é o **tratamento global do 403**. O restante depende de o backend expor as rotas e eventos conforme descrito neste relatório.
