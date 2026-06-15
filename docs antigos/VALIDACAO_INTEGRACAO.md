# Validação: integração frontend ↔ backend (REST + Socket.IO)

**Data:** 13/04/2026  
**Escopo:** autenticação, rotas REST em `/api/*` ou raiz, WebSocket, erros, upload, CORS, headers.

---

## 1. Autenticação

| Item | Status | Implementação |
|------|--------|----------------|
| Login `POST` com `{ email, senha }` | ✅ | `src/auth/authService.js` → `POST /usuarios/login` |
| Alternativa `POST /api/usuarios/login` | ⚠️ | Não usada; se o backend só expuser sob `/api`, defina `VITE_API_URL` com sufixo `/api` **e** alinhe rotas que hoje não usam prefixo (ver secção 2). |
| Resposta `{ token, user/usuario, ... }` | ✅ | `authStore` usa `data.usuario` (PT) e `data.token`. |
| `Authorization: Bearer <token>` | ✅ | Interceptor em `src/api/http.js` lê `localStorage` `zap_erp_auth`. |
| 401 | ✅ | Remove auth, desliga socket, redireciona para `/login` (exceto se já estiver em `/login`). |
| Logout | ✅ | `authStore.logout()` limpa storage, `disconnectSocket()`, stores, `window.location.href = "/login"`. |

---

## 2. Rotas principais (checklist vs frontend)

Convencção: `baseURL` = `VITE_API_URL` ou fallback em `src/api/baseUrl.js`. Caminhos abaixo são relativos a essa base.

| Checklist (exemplo) | Frontend usa | Ficheiros |
|---------------------|----------------|-----------|
| `GET /api/dashboard/overview` | `GET /dashboard/overview` | `src/api/dashboardService.js` |
| `GET /api/dashboard/metrics` | **Não chamado** | O dashboard usa só `getOverview` (`/dashboard/overview`). Se existir métrica extra no backend, falta integrar. |
| `GET /api/dashboard/departamentos` | `GET /dashboard/departamentos` | `dashboardService.js`, `configService.js`, `ConversaView.jsx`, `IA.jsx`, `chatList.jsx` |
| `GET /api/chats` | `GET /chats` (+ query) | `src/chats/chatService.js` |
| `GET /api/chats/:id` | `GET /chats/:id` | `chatService.js`, `conversaService.js` |
| `POST /api/chats/:id/mensagens` | `POST /chats/:id/mensagens` | `chatService.js`, `conversaService.js` (body: `texto`, `reply_meta`, `link`, etc.) |
| `POST /api/chats/:id/assumir` | `POST /chats/:id/assumir` | `conversaService.js`, `atendimentoService.js` |
| `POST /api/chats/:id/encerrar` | `POST /chats/:id/encerrar` | idem |
| `POST /api/chats/:id/transferir` | `POST /chats/:id/transferir` | `conversaService.js` — body **`{ para_usuario_id, observacao }`**, não `departamento_id` |
| Transferência de **setor** | `PUT /chats/:id/departamento` com `{ departamento_id }` ou `{ remover_setor: true }` | `ConversaView.jsx` — contrato distinto do checklist genérico “transferir” |
| `GET /api/chats/zapi-status` | `GET /chats/zapi-status` | `chatService.js` |
| `GET /api/integrations/zapi/status` | **Não** | Usa-se `GET /api/integrations/zapi/connect/status` (`zapiIntegration.js`) + `GET /api/integrations/zapi/operational-status` |
| `POST .../connect/qrcode` | `POST /api/integrations/zapi/connect/qrcode` | `zapiIntegration.js` |
| `GET /api/clientes` | `GET /clientes` | `configService.js` |
| `GET /api/usuarios` | `GET /usuarios` | `configService.js`, `chatList.jsx`, `AtendimentoActions.jsx`, `dashboardService.getUsuarios` |
| `GET /api/tags` | `GET /tags` | `tagService.js`, `configService.js`, `IA.jsx` |
| `GET /api/ia/config` | `GET /ia/config` | `src/api/iaService.js` |
| `POST /api/ai/ask` | `POST /api/ai/ask` com `{ question, period_days? }` | `DashboardIA.jsx` |
| Chat interno | Tudo sob `/api/internal-chat/...` | `internalChatService.js` |

### Prefixo `/api`

- Rotas “core” (`/chats`, `/dashboard`, `/usuarios/login`, `/ia/config`, …) **sem** `/api` no path.
- Rotas com prefixo explícito: `/api/ai/ask`, `/api/internal-chat/*`, `/api/integrations/zapi/*`, `/api/integrations/whatsapp/*`.

O backend deve aceitar estes caminhos na mesma origem que `baseURL`, **ou** `VITE_API_URL` deve ser a raiz correta (ex.: `https://host` vs `https://host/api`) de forma que a URL final bata certo com o servidor — nunca assumir duplo `/api/api/...` ao combinar base + path.

---

## 3. WebSocket (Socket.IO)

| Item | Status | Detalhes |
|------|--------|----------|
| `io(baseURL, { auth: { token } })` | ✅ | `src/socket/socket.js` — `initSocket(token)` |
| Transportes | ✅ | `websocket`, `polling` |
| Reconexão | ✅ | Comportamento padrão do cliente Socket.IO |
| Salas checklist (`empresa_*`, `usuario_*`, `departamento_*`) | ⚠️ | O frontend emite `join_empresa` com `{ company_id, empresa_id }` no `connect`. Não há `join` explícito com nomes `usuario_{id}` / `departamento_{id}` — depende do backend mapear. |
| `join_conversa` / `leave_conversa` | ✅ | `socket.js` + `joinConversaIfNeeded` / `leaveConversa` |
| `typing_start` / `typing_stop` | ✅ emitir | `ConversaView.jsx` com `{ conversa_id }` |
| Eventos escutados (WhatsApp) | ✅ | Inclui `nova_mensagem`, `conversa_atualizada`, `status_mensagem`, `mensagens_lidas`, `typing_start`, `typing_stop`, e vários outros (`mensagem_editada`, `conversa_encerrada`, …) — ver `socket.js`. |
| Chat interno | ✅ | `useInternalChatSocket.js`: `internal_chat:conversation_created`, `internal_chat:message_created`, `internal_chat:conversation_read`. |
| Marcar lida | ✅ emitir | `conversaStore`: `marcar_conversa_lida` |

---

## 4. Tratamento de erros (HTTP)

| Status | Tratamento global | Onde |
|--------|-------------------|------|
| **401** | Limpa auth, desliga socket, redirect `/login` | `http.js` |
| **403** | Toast “Acesso restrito” + mensagem do backend | `http.js` |
| **429** | Toast “Muitas requisições…” | `http.js` |
| **5xx** | Toast “Erro no servidor” | `http.js` |
| Rede / timeout | Toast “Sem conexão…” | `http.js` |

Erros **400** em formulários continuam a ser tratados localmente (ex.: criação de contato em `chatService.criarContato`).

---

## 5. Upload de ficheiros

| Item | Status | Detalhes |
|------|--------|----------|
| `POST /chats/:id/arquivo` | ✅ | `conversaService.js`, `ConversaView.jsx` — `FormData`, campo **`file`**, `Content-Type` deixado ao browser (`headers: { "Content-Type": false }`). |
| Token | ✅ | Interceptor |

---

## 6. CORS e base URL

| Item | Status | Detalhes |
|------|--------|----------|
| Base configurável | ✅ | `VITE_API_URL` (ver `.env.example`); fallback em `baseUrl.js`. |
| Normalização da URL | ✅ | Remove barras finais e sufixo acidental `/usuarios/login`. |
| `withCredentials` | ⚙️ opcional | `http.js`: ativo só com `VITE_WITH_CREDENTIALS=1` ou `true` (evita quebrar CORS com `Allow-Origin: *`). Com Bearer apenas, normalmente não é necessário. |

---

## 7. Headers

| Header | Status |
|--------|--------|
| `Content-Type: application/json` | ✅ default no cliente; multipart sem override manual em uploads. |
| `Authorization: Bearer` | ✅ interceptor. |
| `x-company-id` | ⚠️ Não enviado; multi-tenant usa `company_id` no JWT + filtro em eventos socket (`shouldIgnoreByCompany`). |

---

## 8. Fluxo crítico sugerido (manual)

1. Login → `POST /usuarios/login` → token + `initSocket`.
2. `GET /chats` → lista na sidebar.
3. Abrir conversa → `GET /chats/:id` + `join_conversa`.
4. Enviar texto → `POST /chats/:id/mensagens`.
5. Receber → `nova_mensagem` (e estados via `status_mensagem`).

---

## 9. Resumo e riscos

| Área | Nota |
|------|------|
| Prefixo `/api` | Mistura intencional ou legado; validar contra deploy real do backend. |
| `GET /dashboard/metrics` | Não integrado no UI. |
| `POST .../transferir` | Body do frontend = atribuição a **utilizador** (`para_usuario_id`); setor = **outra** rota (`PUT .../departamento`). |
| Z-API “status” do checklist | Caminho real = `connect/status` + `operational-status`. |
| Salas Socket.IO | Contrato exato de rooms pode diferir do checklist; backend deve aceitar `join_empresa` + joins de conversa. |

**Conclusão:** A integração cobre login, REST principal, socket de atendimento, erros globais, upload e IA. Os pontos ⚠️ exigem confirmação com o contrato OpenAPI/README do backend (prefixos, métricas, rooms e corpo de `transferir`).
