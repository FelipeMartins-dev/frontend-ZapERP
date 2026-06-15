# Prompt para Frontend — Chat em Tempo Real sem Bugs

Use este prompt para ajustar e corrigir o comportamento do chat no frontend:

---

## OBJETIVO

Garantir que o envio e recebimento de mensagens funcione em tempo real, como WhatsApp, sem bugs visuais ou de UX.

---

## PROBLEMAS QUE DEVEM SER RESOLVIDOS

### 1. Contato some da lista ao enviar mensagem
- **Sintoma**: Ao enviar mensagem pelo sistema, o contato desaparece da lista de conversas por um momento e depois volta.
- **Causa provável**: Skeleton de loading substitui a lista inteira durante refresh, ou merge do load() descarta conversas locais.
- **Solução**: Mostrar skeleton APENAS quando não há chats (`loading && chats.length === 0`). Preservar conversas locais no merge do `setChats` no `load()`.

### 2. Mensagem aparece na posição errada
- **Sintoma**: Ao enviar, a mensagem aparece no meio da conversa e só depois vai para o final.
- **Causa provável**: Socket envia mensagem com `criado_em` diferente do otimista; ou substituição do temp altera a ordem.
- **Solução**: Ao substituir mensagem otimista pela real (socket), preservar `criado_em` do otimista quando for mais recente, para manter a posição no final.

### 3. Nome do contato muda automaticamente
- **Sintoma**: Ao enviar/receber mensagem, o nome do contato pisca ou troca.
- **Causa provável**: Payload do socket ou merge do load() sobrescreve `contato_nome` com valor vazio ou incorreto.
- **Solução**: NUNCA sobrescrever `contato_nome` quando já existe um valor válido. Em `addChat`, `updateChat` e merge do `load()`: priorizar o nome existente. Em `nova_mensagem` do socket, nunca usar dados de msg outbound para nome/foto.

### 4. Mensagem duplicada
- **Sintoma**: Ao enviar, a mensagem aparece duas vezes.
- **Causa provável**: Otimista + socket ambos adicionam; ou reconciliação não encontra o temp.
- **Solução**: Fazer UPSERT em `anexarMensagem`: para msg `fromMe`, SEMPRE substituir o temp otimista mais recente com texto compatível. Nunca adicionar como nova se há temp correspondente.

### 5. Lista não atualiza em tempo real
- **Sintoma**: Ao enviar, a conversa não sobe para o topo ou o preview não atualiza.
- **Solução**: Chamar `setUltimaMensagemEBump` (ou `setUltimaMensagem` + `bumpChatToTop`) em uma única operação para evitar múltiplos re-renders e "piscadas". Garantir que a conversa esteja na lista antes de enviar (addChat se não estiver).

---

## REGRAS OBRIGATÓRIAS

1. **Skeleton**: Mostrar apenas quando `loading && chats.length === 0`.
2. **Merge do load()**: Preservar `contato_nome` existente; incluir conversas de `prev` que não vieram da API.
3. **anexarMensagem**: Para msg outbound, substituir temp por id/whatsapp_id/texto; preservar `criado_em` do otimista se mais recente.
4. **contato_nome**: Nunca sobrescrever com vazio, "Conversa" ou dado de msg outbound quando já temos nome válido.
5. **setUltimaMensagem + bumpChatToTop**: Preferir método único `setUltimaMensagemEBump` para um único `set()`.

---

## CHECKLIST DE IMPLEMENTAÇÃO

- [ ] `load()`: merge preserva contato_nome e chats locais
- [ ] `load()`: skeleton só quando `chats.length === 0`
- [ ] `addChat`: não sobrescrever contato_nome quando existente é válido
- [ ] `anexarMensagem`: preservar criado_em do otimista na substituição
- [ ] `socket nova_mensagem`: não usar nome/foto de msg outbound
- [ ] `setUltimaMensagemEBump`: usado no envio e no socket
- [ ] Mensagem enviada: aparece uma vez, no final, em tempo real

---

## ARQUIVOS PRINCIPAIS

- `src/chats/chatList.jsx` — load(), skeleton, merge
- `src/chats/chatsStore.js` — addChat, setUltimaMensagemEBump
- `src/conversa/conversaStore.js` — anexarMensagem
- `src/conversa/ConversaView.jsx` — envio otimista
- `src/socket/socket.js` — nova_mensagem handler
