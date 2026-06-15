# ZapERP — Responsividade Mobile-First

## Implementação concluída

### 1) Base layout responsivo (AppShell)

- **Breakpoints**: mobile <640px | tablet 640-1024px | desktop >1024px
- **Desktop**: Sidebar 320-380px + chat flex (2 colunas)
- **Tablet (≤1024px)**: Sidebar 300-360px + chat
- **Mobile (<640px)**: Uma tela por vez
  - `view="list"`: lista ocupa 100%
  - `view="chat"`: chat ocupa 100% (ao selecionar conversa)
  - Botão voltar no header → volta para lista
  - Estado via `selectedId` no conversaStore

### 2) Altura e teclado

- `100dvh` nos containers principais (atendimento-layout, wa-shell)
- Viewport meta: `interactive-widget=resizes-content` (ajuste ao teclado)
- `env(safe-area-inset-*)` no composer (wa-footer) em todos os breakpoints mobile

### 3) Chat UI fixos

- Header fixo (56px mobile)
- Área de mensagens com `overflow-y: auto`
- Composer fixo no rodapé com safe-area
- Scroll para o fim ao abrir conversa (comportamento preservado)

### 4) Lista de conversas

- Alvos de toque ≥44px
- Avatar 48px desktop, 52-56px em breakpoints mobile
- Nome e última mensagem truncados
- Badge de não lidas visível
- Breakpoint mobile: 640px

### 5) Mensagens e mídia

- **Balão**: 52% desktop (`min(52%, 400px)`), 70% mobile
- **Imagens**: `max-width: 75vw` mobile, 320px desktop
- **Figurinhas**: 120px mobile, 160px desktop
- **Reply**: truncamento mantido

### 6) Menu de anexos (bottom-sheet)

- No mobile (<640px): menu vira bottom-sheet fixo na parte inferior
- Animação `wa-attachSlideUp`
- Safe-area no padding inferior
- Itens com min-height 48px

### 7) Performance

- **Paginação**: ao rolar para o topo (<120px), chama `loadMore`
- Botão "Carregar mais" quando há mais mensagens
- Scroll preservado ao carregar mais (ajuste de `scrollTop`)
- `Bubble` memoizada com `React.memo`

### 8) Telas Config / Conectar WhatsApp

- Cards empilhados no mobile
- Botões em full-width no mobile
- Padding responsivo com safe-area

---

## Checklist manual (PASS/FAIL)

### Mobile
- [ ] Login ok
- [ ] Lista de conversas ok
- [ ] Abrir chat, voltar, alternar conversas ok
- [ ] Input não fica escondido pelo teclado
- [ ] Enviar/receber em tempo real ok
- [ ] Mídia não quebra layout

### Desktop
- [ ] Layout 2 colunas intacto
- [ ] Sem regressões em páginas existentes

---

## Ativação do tema dark

```js
document.documentElement.setAttribute("data-theme", "dark");
```

Configurações em `Configuracoes.jsx` ou via preferência do sistema.
