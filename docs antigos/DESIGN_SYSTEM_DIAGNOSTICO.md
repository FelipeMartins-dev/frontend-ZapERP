# ZapERP — Diagnóstico Visual e Proposta de Design System

**Design System Lead | Frontend Senior**  
*Evolução não destrutiva · SaaS B2B WhatsApp Premium*

---

## 1. Diagnóstico Visual do Frontend Atual

### Pontos fortes
- **Design System em `theme.css`**: Tokens semânticos (`--ds-*`) bem estruturados
- **Tema claro/escuro**: `data-theme` persistido em localStorage
- **Cores WhatsApp**: Verde acento (#00a884) consistente; bolhas e fundo fiéis ao WhatsApp Web
- **Tipografia**: Inter e Plus Jakarta Sans com preconnect
- **Atendimento**: Layout grid responsivo (sidebar + chat), mobile com troca de tela
- **Skeleton**: Existe `SkeletonList` em `chatList.jsx`
- **Acessibilidade**: `prefers-reduced-motion`, `focus-visible`, aria-labels em partes do fluxo

### Pontos de atenção
- **Fontes conflitantes**: `body` usa `Segoe UI, Arial`; componentes usam `Inter`
- **CSS grande**: `conversa.css` (~4.7k linhas), `IA.css` (~2.6k linhas)
- **Inline styles**: `GlobalNotifications`, alerta Z-API desconectado, `KpiCard`
- **Múltiplos prefixos de tokens**: `--ds-*`, `--cl-*`, `--wa-*`, `--dash-*`, `--zpl-*`
- **Valores hardcoded**: `#dc2626`, `#856404`, `#fff3cd`, `#0d9488` em vários arquivos
- **Páginas ausentes**: Campanhas e Integrações não existem no projeto

---

## 2. Problemas de UX

| Área | Problema | Impacto |
|------|----------|---------|
| **Login** | Não adapta ao tema do sistema; fundo sempre escuro | Desconexão com o restante do app em light |
| **Loading** | "Carregando métricas..." só texto no Dashboard | Sensação de travamento |
| **Empty states** | Mensagens genéricas ("Nenhuma conversa encontrada") | Pouca orientação |
| **Feedback** | Toast sem ícones por tipo (sucesso/erro/aviso) | Difícil leitura rápida |
| **Filtros** | Painel de filtros grande, sem collapse visual | Ocupa espaço na lista |
| **Mobile** | Sidebar vira barra inferior; algumas tabelas difíceis de scroll | UX aceitável mas melhorável |
| **Modais** | Padrão não unificado (Config, IA, Permissões) | Inconsistência |
| **Breadcrumbs** | Não existem | Usuário perde contexto em telas aninhadas |

---

## 3. Problemas de Consistência Visual

| Elemento | Onde | Problema |
|----------|------|----------|
| **Botões** | `dash-btn`, `ia-*`, `chat-list-*` | Variação de tamanho, radius, padding |
| **Inputs** | Login, Dashboard, Config, IA | Bordas e focus diferentes |
| **Cards** | `dash-card`, `surface`, `ia-content` | Bordas, sombras e padding distintos |
| **Tabelas** | Dashboard, Relatórios | Sem componente unificado |
| **Cores de erro** | `#dc2626`, `#fef2f2`, `#fecaca` | Não vêm de tokens |
| **Switch** | IA, Configurações | Mesmo componente, mas duplicado |
| **Tabs** | Dashboard, IA, Config | Estilos parecidos mas não idênticos |

---

## 4. Proposta de Identidade Visual

### Direção
- **Área de conversas**: Estética WhatsApp Web Premium (fundo bege/gradiente, bolhas fiéis)
- **Área administrativa**: SaaS B2B moderno (Linear, Notion, Slack) — limpo, neutro, profissional
- **Tom**: Confiável, eficiente, sem ruído; verde como acento único

### Paleta sugerida (refinar em tokens)
| Uso | Light | Dark |
|-----|-------|------|
| Base | #f0f2f5 | #0b141a |
| Surface | #ffffff | #111b21 |
| Accent | #00a884 | #00a884 |
| Erro | #dc2626 → token | #f87171 → token |
| Aviso | #d97706 → token | #fbbf24 → token |
| Sucesso | #00a884 (accent) | #06cf9c |

---

## 5. Proposta de Design System

### Estrutura sugerida
```
src/
├── design-system/
│   ├── tokens.css          # cores, espaçamento, raio, sombra
│   ├── typography.css      # fontes, tamanhos, pesos
│   └── animations.css      # transições, keyframes
├── components/
│   ├── ui/                 # primitivos
│   │   ├── Button.jsx
│   │   ├── Input.jsx
│   │   ├── Select.jsx
│   │   ├── Card.jsx
│   │   ├── Switch.jsx
│   │   ├── Tab.jsx
│   │   └── Badge.jsx
│   ├── layout/
│   │   ├── Sidebar.jsx
│   │   ├── Header.jsx
│   │   └── Breadcrumb.jsx
│   ├── feedback/
│   │   ├── Toast.jsx
│   │   ├── Skeleton.jsx
│   │   ├── EmptyState.jsx
│   │   └── Alert.jsx
│   └── data/
│       ├── Table.jsx
│       └── DataGrid.jsx
```

### Migração gradual
- Manter `theme.css` como fonte de tokens
- Criar componentes em `components/ui/` consumindo tokens
- Migrar telas para usar componentes (uma por vez)
- Deprecar estilos inline e valores hardcoded

---

## 6. Tokens de Cor

### Atual (theme.css) — manter e estender
```css
/* Superfícies */
--ds-bg-base, --ds-bg-raised, --ds-surface-1/2/3

/* Texto */
--ds-text-primary, --ds-text-secondary, --ds-text-tertiary, --ds-text-muted

/* Acento */
--ds-accent, --ds-accent-soft, --ds-accent-hover, --ds-accent-muted

/* Estados semânticos — adicionar */
--ds-success: #00a884;      /* ou var(--ds-accent) */
--ds-error: #dc2626;        /* light */
--ds-error-dark: #f87171;   /* dark */
--ds-warning: #d97706;
--ds-warning-dark: #fbbf24;
--ds-info: #2563eb;
```

---

## 7. Tokens de Espaçamento

### Atual
```css
--ds-space-1: 4px;
--ds-space-2: 8px;
--ds-space-3: 12px;
--ds-space-4: 16px;
--ds-space-5: 20px;
--ds-space-6: 24px;
```

### Sugestão de extensão
```css
--ds-space-7: 28px;
--ds-space-8: 32px;
--ds-space-10: 40px;
--ds-space-12: 48px;
--ds-space-16: 64px;
```

---

## 8. Tokens de Borda e Sombra

### Atual
```css
--ds-border, --ds-border-strong
--ds-shadow-xs, --ds-shadow-sm, --ds-shadow-md, --ds-shadow-lg
--ds-radius-sm, --ds-radius, --ds-radius-md, --ds-radius-lg, --ds-radius-full
```

### Sugestão
- Manter como está
- Adicionar `--ds-radius-xl: 16px` para cards grandes
- Adicionar `--ds-shadow-toast` para toasts flutuantes

---

## 9. Padrão de Botões

### Classes sugeridas (ou componente Button)
| Variante | Uso |
|----------|-----|
| `btn--primary` | Ação principal (Entrar, Salvar, Aplicar) |
| `btn--secondary` / `btn--outline` | Ações secundárias |
| `btn--ghost` | Ações terciárias, ícones |
| `btn--danger` | Excluir, cancelar crítico |
| `btn--sm` / `btn--lg` | Tamanhos |

### Especificações
- Altura: 40px (default), 32px (sm), 48px (lg)
- Padding horizontal: 16px (default)
- Border-radius: `var(--ds-radius)`
- Transição: `var(--ds-transition)`
- Focus: `outline: 2px solid var(--ds-focus-ring)`

---

## 10. Padrão de Inputs

### Especificações
- Altura: 40px
- Padding: 12px 14px
- Border: 1px solid var(--ds-border)
- Border-radius: var(--ds-radius)
- Focus: border-color var(--ds-accent), box-shadow 0 0 0 3px var(--ds-accent-soft)
- Label acima, 12px, font-weight 600, cor --ds-text-secondary

---

## 11. Padrão de Tabelas

### Especificações
- Header: fundo var(--ds-surface-2), texto --ds-text-secondary, 12px uppercase
- Linhas: zebra sutil ou hover em --ds-hover
- Células: padding 12px 16px
- Border: 1px solid var(--ds-border)
- Empty state: célula única, texto centralizado, ícone + mensagem

---

## 12. Padrão de Cards

### Especificações
- Background: var(--ds-surface-1)
- Border: 1px solid var(--ds-border)
- Border-radius: var(--ds-radius-lg)
- Padding: 18px–24px
- Box-shadow: var(--ds-shadow-xs)
- Hover: var(--ds-shadow-sm), border-color var(--ds-border-strong)

---

## 13. Padrão de Sidebar e Header

### Sidebar (MainLayout)
- Largura: 56–64px (compacta)
- Background: var(--ds-surface-1)
- Item ativo: background var(--ds-accent-soft), color var(--ds-accent)
- Mobile: barra inferior, 56px + safe-area

### Header (conversa)
- Altura: 56px
- Background: var(--ds-chat-header)
- Border-bottom: 1px solid var(--ds-border)

---

## 14. Melhorias da Tela de Conversa (WhatsApp Web Premium)

| Melhoria | Descrição |
|----------|-----------|
| **Fundo** | Manter gradiente; padronizar opacidade do padrão em dark |
| **Bolhas** | Já fiéis; garantir contraste em dark (--ds-bubble-out escuro) |
| **Header** | Adicionar breadcrumb "Atendimento > Nome do contato" em desktop |
| **Input** | Ajustar placeholder para dark; ícones com contraste |
| **Sidebar cliente** | Usar tokens; animação suave ao abrir |
| **Mensagens vazias** | Estado vazio com ilustração e CTA "Envie a primeira mensagem" |
| **Scroll** | Manter scroll suave; indicador "novas mensagens" já comum em chats |

---

## 15. Melhorias do Dashboard Executivo

| Melhoria | Descrição |
|----------|-----------|
| **Skeleton** | Substituir "Carregando métricas..." por grid de cards skeleton |
| **KPIs** | Garantir alinhamento; ícones opcionais por métrica |
| **Gráficos** | Cores dos gráficos via tokens; acessibilidade (labels, alto contraste) |
| **Período** | Select mais destacado; possível DateRangePicker futuro |
| **Tabs** | Unificar com componente Tab reutilizável |
| **Empty** | Ilustração + "Configure seu primeiro atendimento" |

---

## 16. Melhorias das Telas Administrativas

| Tela | Melhorias |
|------|-----------|
| **Configurações** | Breadcrumb; tabs com indicador de tab ativa; formulários com labels consistentes |
| **IA / Chatbot** | Mesmo padrão de tabs; switches unificados; logs em tabela padrão |
| **Permissões** | Card por usuário; checkboxes com estado claro |
| **Usuários** | Tabela com ações (editar, remover); modal de criação padrão |
| **Connect WhatsApp** | Progress steps visuais; estados de conexão claros |

---

## 17. Melhorias de Acessibilidade

| Melhoria | Ação |
|----------|------|
| **Contraste** | Validar todos os textos com background (WCAG 2.1 AA) |
| **Focus** | Garantir focus-visible em todos os controles |
| **Labels** | Associar labels a inputs; aria-label em ícones |
| **Skip link** | "Pular para conteúdo principal" no topo |
| **Redução de movimento** | Manter prefers-reduced-motion em animações |
| **Tema** | Respeitar prefers-color-scheme como fallback |

---

## 18. Melhorias para Modo Dark

| Área | Melhoria |
|------|----------|
| **Login** | Versão light do formulário ou adaptar orbs ao tema |
| **Toast** | Usar tokens (--ds-surface-1, --ds-border) em vez de #fff |
| **Alerta Z-API** | Trocar inline styles por classes com tokens |
| **IA error banner** | Adicionar variante dark (--ds-error, fundo --ds-accent-soft com tom erro) |
| **Tabelas** | Garantir zebra e hover visíveis em dark |
| **Modais** | Background e borda via tokens |

---

## 19. Plano de Implementação por Etapas

### Fase 1 — Fundação (1–2 semanas)
1. Estender `theme.css` com tokens de erro, aviso, sucesso
2. Unificar fonte do body para Inter
3. Criar componente `Toast` (substituir GlobalNotifications inline)
4. Criar componente `Button` com variantes
5. Criar componente `Input` e `Select` base

### Fase 2 — Componentes de Feedback (1 semana)
6. Componente `Skeleton` (card, linha, grid)
7. Componente `EmptyState` (ícone + título + descrição + CTA)
8. Componente `Alert` / Banner de erro
9. Aplicar Skeleton no Dashboard
10. Aplicar EmptyState na lista de conversas

### Fase 3 — Layout e Navegação (1 semana)
11. Componente `Breadcrumb`
12. Componente `Tabs` unificado
13. Adicionar breadcrumbs em Configurações, IA, Permissões
14. Revisar Sidebar (manter estrutura, garantir tokens)

### Fase 4 — Formulários e Tabelas (1–2 semanas)
15. Componente `Card`
16. Componente `Switch` único (extrair de IA/Config)
17. Componente `Table` com empty state
18. Migrar filtros e formulários para Input/Select padrão
19. Migrar tabelas de relatórios para Table

### Fase 5 — Polish e Dark (1 semana)
20. Toast e Alert com suporte a dark
21. Login: variante light ou detecção de tema
22. Revisar todos os inline styles restantes
23. Testes de contraste e acessibilidade

---

## 20. Componentes Reaproveitáveis

| Componente | Onde está | Reuso |
|------------|-----------|-------|
| `ZapERPLogo` | brand/ | Mantido; verificar variantes |
| `ErrorBoundary` | components/ | Mantido |
| `Switch` (ia-switch) | IA.jsx, Configuracoes.jsx | Extrair para `components/ui/Switch.jsx` |
| `StatCard` | Dashboard.jsx | Padronizar e mover para `components/ui/StatCard.jsx` |
| `SkeletonList` | chatList.jsx | Generalizar para `components/feedback/Skeleton.jsx` |
| `AtendimentoActions` | atendimento/ | Mantido; estilizar com tokens |
| `BarList` | Dashboard.jsx | Manter ou extrair para dashboard específico |

---

## 21. Componentes Novos Sugeridos

| Componente | Prioridade | Descrição |
|------------|------------|-----------|
| `Button` | Alta | Variantes primary, outline, ghost, danger, sm/lg |
| `Input` | Alta | Text, password, com label e erro |
| `Select` | Alta | Estilizado, acessível |
| `Toast` | Alta | Substituir GlobalNotifications |
| `Card` | Alta | Container padrão para painéis |
| `Skeleton` | Alta | Card, linha, avatar |
| `EmptyState` | Média | Ilustração, título, descrição, CTA |
| `Tabs` | Média | Unificar Dashboard, IA, Config |
| `Table` | Média | Header, body, empty, zebra |
| `Switch` | Média | Extrair dos formulários |
| `Breadcrumb` | Média | Navegação contextual |
| `Modal` | Média | Overlay + conteúdo; variantes |
| `Badge` | Baixa | Contagem, status |
| `Alert` | Baixa | Banner de erro/aviso/sucesso |

---

## 22. O Que NÃO Deve Ser Alterado

| Item | Motivo |
|------|--------|
| **Lógica de negócio** | APIs, stores, fluxos de atendimento |
| **Estrutura de rotas** | AppRoutes, ProtectedRoute, permissões |
| **Serviços (api/)** | http, dashboardService, chatService etc. |
| **Stores (Zustand)** | authStore, chatsStore, conversaStore, notificationStore |
| **Socket** | Integração em tempo real |
| **Fluxo de atendimento** | Assumir, transferir, encerrar |
| **Integração Z-API** | Conexão WhatsApp |
| **Permissões** | can(), roles, verificação de acesso |

---

## 23. Resumo Executivo

O frontend tem uma base sólida com design system em `theme.css` e tema claro/escuro. As melhorias devem ser **evolutivas**, focando em:

1. **Consistência**: Componentes reutilizáveis (Button, Input, Card, Table)
2. **Tokens**: Eliminar valores hardcoded; adicionar tokens semânticos (erro, aviso)
3. **Feedback**: Toast, Skeleton, EmptyState padronizados
4. **Dark mode**: Cobrir Login, Toast e alertas
5. **Acessibilidade**: Contraste, focus, labels

O plano em 5 fases (~6–7 semanas) permite entregas incrementais sem quebrar o sistema.

---

*Documento gerado para evolução do frontend ZapERP · Não destrutivo · Preservar lógica de negócio*
