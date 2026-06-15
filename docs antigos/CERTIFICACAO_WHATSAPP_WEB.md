# Certificação WhatsApp Web-Like — Frontend

## Patch aplicado

### 1. Socket (Realtime)
- **nova_mensagem**: De-dup por `whatsapp_id` e `id` — evita duplicar mensagens quando conversa aberta
- **status_mensagem**: Fallback por `whatsapp_id` quando `mensagem_id` não encontrar — atualiza ticks na conversa e na lista
- Listeners mantidos: `conversa_atualizada`, `atualizar_conversa`, `zapi_sync_contatos`

### 2. Dedupe na lista de conversas
- Chave por: `telefone` || `canonicalPhone` || `chatLid` (ou `id`/`cliente_id`)
- Preferência em duplicatas: tem telefone > última atividade mais recente > tem nome/foto
- Remove entradas duplicadas para não mostrar "Sem conversa"

### 3. Render de nome / foto / telefone
- **Nome**: `cliente.nome` || `nome_contato_cache` || `pushname` || telefone formatado
- **Foto**: `cliente.foto_perfil` || `foto_perfil_contato_cache` || `senderPhoto` || avatar padrão
- **Telefone**: Formatado BR (+55 (XX) XXXXX-XXXX)

### 4. Ticks / status
- Mapeamento existente mantido: pending/sent → 1 tick, delivered/read → 2 ticks, read → 2 azul, played → indicador
- Atualização em tempo real via `status_mensagem` (por id e whatsapp_id)

### 5. Botão "Sincronizar contatos"
- Local: header da lista (ao lado de Atualizar)
- Chamada: `POST /chats/sincronizar-contatos`
- Toast de sucesso: "Sincronização: X novos, Y atualizados"
- Tratamento de erros:
  - **401** → redireciona para login
  - **409 / needsRestore** → toast "Reconectar WhatsApp"
  - **502+** → toast "Falha ao sincronizar"

---

## Checklist de certificação (PASS/FAIL)

| # | Critério | Como testar | Status |
|---|----------|-------------|--------|
| 1 | Receber do celular: aparece em tempo real | Enviar msg do celular → deve aparecer no chat sem reload | ⬜ |
| 2 | Enviar do CRM: aparece no chat e chega no celular | Enviar msg pelo CRM → ver no chat e no celular | ⬜ |
| 3 | Ticks mudam em tempo real | Enviar msg → observar transição sent → delivered → read | ⬜ |
| 4 | Não existe conversa duplicada na lista | Verificar lista após msgs e sync | ⬜ |
| 5 | Nomes/fotos corretos em pelo menos 10 contatos | Checar lista e chat header | ⬜ |
| 6 | Sync contatos atualiza/incrementa contatos e lista | Clicar "Sincronizar contatos" → ver toast e lista atualizada | ⬜ |

### Passos para teste

1. **Realtime recebido**  
   - Conectar WhatsApp (QR), abrir uma conversa  
   - No celular, enviar mensagem para o número  
   - ✓ Mensagem aparece imediatamente no chat (sem F5)

2. **Realtime enviado**  
   - Do CRM, enviar mensagem  
   - ✓ Aparece como OUT no chat; ✓ chega no celular

3. **Ticks**  
   - Enviar mensagem → observar ícone (1✓ → 2✓ → 2✓ azul)

4. **Dedupe**  
   - Carregar conversas, verificar que não há linhas duplicadas para o mesmo contato

5. **Nome/foto**  
   - Conferir 10+ contatos: nome e avatar corretos (ou telefone quando sem nome)

6. **Sync contatos**  
   - Clicar ícone de sync no header  
   - ✓ Loading → Toast "X novos, Y atualizados"  
   - ✓ Lista de conversas atualizada

---

## Arquivos alterados

- `src/socket/socket.js`
- `src/conversa/conversaStore.js`
- `src/chats/chatList.jsx`
- `src/chats/chatList.css`
- `src/conversa/ConversaView.jsx`
- `src/conversa/SidebarCliente.jsx`
