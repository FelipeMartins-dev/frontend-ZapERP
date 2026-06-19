import {
  SectionHeader, Card, Tip, Steps, BtnGrid, StatusGrid,
  DataTable, Checklist, Quote, TagList, PriorityList, SubSection, Ul,
} from "./ManualComponents";

export function ManualContent({ setSectionRef }) {
  return (
    <>

      {/* 1 · OBJETIVO */}
      <section ref={setSectionRef("objetivo")} className="manual-section" id="objetivo">
        <SectionHeader icon="🎯" iconClass="manual-section-icon--green" title="Objetivo do ZapERP"
          subtitle="Para que serve a plataforma e qual é o seu papel como atendente" />
        <Tip>
          O ZapERP é uma plataforma de <strong>atendimento corporativo</strong> que centraliza as
          conversas do WhatsApp em uma única tela, permitindo que a empresa organize os atendimentos
          por setor, atendente, status e histórico.
        </Tip>
        <Card title="🎯 Seu objetivo como atendente">
          <Ul items={[
            "Responder os clientes com <strong>agilidade</strong>",
            "Manter o atendimento <strong>organizado</strong>",
            "Registrar corretamente cada conversa até sua <strong>finalização</strong>",
          ]} />
        </Card>
      </section>

      {/* 2 · ACESSO */}
      <section ref={setSectionRef("acesso")} className="manual-section" id="acesso">
        <SectionHeader icon="🔐" iconClass="manual-section-icon--blue" title="Acesso ao Sistema"
          subtitle="Login, credenciais e cuidados com o acesso" />
        <SubSection title="2.1 Login">
          <Card title="🔑 Como acessar">
            Cada atendente acessa o ZapERP com seu <strong>próprio usuário</strong>, usando:
            <Ul items={[
              "<strong>E-mail</strong> cadastrado",
              "<strong>Senha</strong> pessoal",
              "<strong>Empresa</strong> vinculada",
              "<strong>Permissões</strong> definidas pelo administrador",
            ]} />
            Cada ação realizada no sistema fica vinculada ao atendente logado.
          </Card>
        </SubSection>
        <SubSection title="2.2 Cuidados com o acesso">
          <Tip variant="orange" icon="⚠️">
            <Ul items={[
              "Não compartilhe sua senha com outros usuários",
              "Use apenas o seu próprio login",
              "O sistema registra quem assumiu, respondeu, transferiu ou finalizou cada atendimento",
            ]} />
          </Tip>
        </SubSection>
      </section>

      {/* 3 · TELA PRINCIPAL */}
      <section ref={setSectionRef("tela-principal")} className="manual-section" id="tela-principal">
        <SectionHeader icon="🖥️" iconClass="manual-section-icon--teal" title="Tela Principal de Atendimento"
          subtitle="Como a tela está organizada" />
        <div className="manual-layout-diagram">
          <div className="manual-layout-diagram-header">🖥️ Layout da tela principal</div>
          <div className="manual-layout-diagram-body">
            <div className="manual-layout-zone" style={{ maxWidth: "60px", background: "var(--ds-bg, #f9fafb)" }}>
              <div className="manual-layout-zone-label">Menu</div>
              <div className="manual-layout-zone-name">Sidebar</div>
              <ul className="manual-layout-zone-items"><li>Navegação</li><li>Tema / Sair</li></ul>
            </div>
            <div className="manual-layout-zone" style={{ maxWidth: "200px" }}>
              <div className="manual-layout-zone-label">Esquerda</div>
              <div className="manual-layout-zone-name">Lista de Conversas</div>
              <ul className="manual-layout-zone-items"><li>Filtros</li><li>Busca</li><li>Pendências</li><li>Conversas</li></ul>
            </div>
            <div className="manual-layout-zone">
              <div className="manual-layout-zone-label">Direita</div>
              <div className="manual-layout-zone-name">Área de Mensagens</div>
              <ul className="manual-layout-zone-items"><li>Cabeçalho do cliente</li><li>Histórico</li><li>Campo de envio</li><li>Botões de ação</li><li>Perfil do cliente</li></ul>
            </div>
          </div>
        </div>
        <Card>
          A tela principal mostra a <strong>lista de conversas</strong> e o <strong>painel de mensagens</strong>.
          No celular, lista e chat ficam em telas separadas — toque na conversa para abrir e use a seta ← para voltar.
        </Card>
      </section>

      {/* 4 · LISTA DE CONVERSAS */}
      <section ref={setSectionRef("lista-conversas")} className="manual-section" id="lista-conversas">
        <SectionHeader icon="💬" iconClass="manual-section-icon--teal" title="Lista de Conversas"
          subtitle="O que cada linha da lista exibe" />
        <Card title="📋 Informações exibidas em cada conversa">
          <Ul items={[
            "<strong>Nome</strong> do cliente",
            "<strong>Número de telefone</strong>",
            "<strong>Última mensagem</strong> com prévia",
            "<strong>Horário</strong> da última interação",
            "<strong>Status</strong> do atendimento",
            "<strong>Atendente responsável</strong>",
            "<strong>Setor</strong> vinculado",
            "<strong>Quantidade de mensagens não lidas</strong>",
            "<strong>Tags</strong> ou identificações",
            "<strong>Protocolo</strong>, quando houver",
          ]} />
        </Card>
        <Tip variant="orange" icon="⚠️">
          A lista deve ser acompanhada com atenção para <strong>evitar atrasos</strong> no atendimento.
        </Tip>
      </section>

      {/* 5 · FILTROS */}
      <section ref={setSectionRef("filtros")} className="manual-section" id="filtros">
        <SectionHeader icon="🔍" iconClass="manual-section-icon--purple" title="Filtros de Atendimento"
          subtitle="Todos os filtros disponíveis e quando usar cada um" />
        <Tip variant="blue" icon="ℹ️">
          Os filtros ajudam a localizar rapidamente as conversas corretas. Clique nos chips abaixo da busca ou abra o painel de <strong>Filtros avançados</strong>.
        </Tip>

        <SubSection title="5.1 Minha fila">
          <Card>
            Mostra os atendimentos que dependem do atendente logado. Pode incluir:
            <Ul items={[
              "Conversas abertas destinadas ao atendente",
              "Conversas transferidas para ele",
              "Conversas aguardando resposta do atendente",
              "Conversas em atendimento sob sua responsabilidade",
            ]} />
            <Tip>A <strong>"Minha fila"</strong> é o principal filtro do atendente. Use sempre como ponto de partida do dia.</Tip>
          </Card>
        </SubSection>

        <DataTable
          headers={["Filtro", "O que mostra", "Quando usar"]}
          rows={[
            ["<span class='manual-chip manual-chip--active'>Minha fila</span>", "Atendimentos do atendente logado", "Principal filtro do dia a dia"],
            ["<span class='manual-chip'>Todas</span>", "Conversas que o usuário tem permissão para visualizar", "Localizar clientes pelo nome, telefone ou histórico"],
            ["<span class='manual-chip'>Hoje</span>", "Conversas movimentadas no dia atual", "Acompanhar atendimentos recentes"],
            ["<span class='manual-chip'>Não lidas</span>", "Conversas com mensagens ainda não visualizadas", "<strong>Priorizar</strong> para evitar clientes sem resposta"],
            ["<span class='manual-chip'>Abertas</span>", "Conversas que ainda não foram assumidas", "Ver fila aguardando atendimento"],
            ["<span class='manual-chip'>Em atendimento</span>", "Conversas assumidas e ainda não finalizadas", "Ver atendimentos ativos da equipe"],
            ["<span class='manual-chip'>Aguardando cliente</span>", "Empresa respondeu, aguarda retorno do cliente", "Não é pendência do atendente"],
            ["<span class='manual-chip'>Aguardando atendente</span>", "Cliente enviou mensagem e aguarda resposta", "<strong>Priorizar!</strong>"],
            ["<span class='manual-chip'>Finalizadas</span>", "Atendimentos encerrados", "Consulta de histórico e reabertura"],
            ["<span class='manual-chip'>Por ausência</span>", "Encerradas por falta de retorno do cliente", "Quando recurso estiver ativo"],
            ["<span class='manual-chip'>Disparadas</span>", "Conversas iniciadas por mensagem enviada pelo celular/WhatsApp fora do ZapERP", "Ver regras abaixo"],
          ]}
        />

        <SubSection title="5.11 Mensagens disparadas — regras importantes">
          <Tip variant="orange" icon="⚠️">
            Esse filtro considera <strong>apenas</strong> conversas iniciadas por mensagem enviada pela empresa
            diretamente pelo celular/WhatsApp <strong>fora do ZapERP</strong>.
          </Tip>
          <Card title="❌ NÃO entra nesse filtro quando:">
            <Ul items={[
              "O cliente chamou primeiro",
              "Já existia atendimento aberto",
              "O atendente respondeu pelo ZapERP",
              "A conversa foi iniciada normalmente dentro do fluxo de atendimento",
            ]} />
          </Card>
        </SubSection>
      </section>

      {/* 6 · BUSCA */}
      <section ref={setSectionRef("busca")} className="manual-section" id="busca">
        <SectionHeader icon="🔎" iconClass="manual-section-icon--blue" title="Busca de Conversas"
          subtitle="Como localizar clientes rapidamente" />
        <Card title="🔎 O que você pode buscar">
          <Ul items={[
            "<strong>Nome</strong> ou parte do nome",
            "<strong>Número de telefone</strong> ou parte do número",
            "<strong>CPF/CNPJ</strong>, se disponível",
            "Informação registrada no contato",
          ]} />
        </Card>
        <Tip variant="blue" icon="ℹ️">
          Ao pesquisar, o sistema traz apenas conversas compatíveis com o <strong>filtro atual</strong> e com as
          <strong> permissões</strong> do usuário. Exemplo: no filtro "Todas", pesquisar um nome exibe os clientes
          encontrados desde que você tenha permissão para visualizar.
        </Tip>
      </section>

      {/* 7 · STATUS */}
      <section ref={setSectionRef("status")} className="manual-section" id="status">
        <SectionHeader icon="🟢" iconClass="manual-section-icon--orange" title="Status dos Atendimentos"
          subtitle="O que cada status significa e como agir" />
        <StatusGrid items={[
          { color: "fila", name: "Aberta", desc: "Conversa aberta e ainda pode precisar ser assumida por um atendente." },
          { color: "em_atendimento", name: "Em atendimento", desc: "Conversa sendo atendida por um atendente. Cliente em atendimento ativo." },
          { color: "aguardando", name: "Aguardando atendente", desc: "Cliente enviou mensagem e aguarda resposta. Tratar como PRIORIDADE." },
          { color: "aguardando", name: "Aguardando cliente", desc: "Empresa respondeu e aguarda retorno. NÃO conta como pendência do atendente." },
          { color: "fechada", name: "Finalizada", desc: "Atendimento encerrado. Disponível no histórico, mas não aparece como ativo." },
          { color: "aberta", name: "Reaberta", desc: "Conversa finalizada que voltou por nova mensagem do cliente ou reabertura manual." },
        ]} />
      </section>

      {/* 8 · ASSUMIR */}
      <section ref={setSectionRef("assumir")} className="manual-section" id="assumir">
        <SectionHeader icon="✅" iconClass="manual-section-icon--green" title="Assumir Atendimento"
          subtitle="Como assumir uma conversa e o que acontece" />
        <Card title="✅ O que acontece ao assumir">
          <Ul items={[
            "A conversa passa a ficar <strong>vinculada ao atendente</strong>",
            "O status muda para <strong>\"Em atendimento\"</strong>",
            "O restante da equipe respeita que aquele atendimento já possui responsável",
            "A conversa aparece na fila correta do atendente responsável",
          ]} />
        </Card>
        <Tip variant="orange" icon="⚠️">
          Assuma apenas conversas que <strong>realmente irá atender</strong>. Para editar dados do cliente ou
          adicionar notas, é necessário ter assumido a conversa.
        </Tip>
        <Steps items={[
          "Na aba <strong>Minha fila</strong>, clique na conversa do cliente",
          "Clique em <strong>Assumir</strong> no rodapé ou cabeçalho da conversa",
          "A conversa agora é sua — responda e registre as informações",
        ]} />
      </section>

      {/* 9 · COMPARTILHADO */}
      <section ref={setSectionRef("compartilhado")} className="manual-section" id="compartilhado">
        <SectionHeader icon="👥" iconClass="manual-section-icon--blue" title="Atendimento Compartilhado"
          subtitle="Dois atendentes na mesma conversa" />
        <Card title="👥 Como funciona">
          Quando o recurso estiver habilitado, um atendente pode chamar outro para participar da mesma conversa:
          <Ul items={[
            "A conversa continua em <strong>atendimento</strong>",
            "Os dois atendentes conseguem acompanhar e responder o mesmo cliente",
            "A conversa aparece como atendimento para os atendentes envolvidos",
            "Para os demais, a conversa segue as regras normais de visualização",
            "O cliente não precisa saber que há mais de um atendente acompanhando",
          ]} />
        </Card>
        <Tip>
          Use para: <strong>apoio interno, dúvidas técnicas, negociação, financeiro, suporte</strong> ou casos
          que precisam de mais de uma pessoa acompanhando.
        </Tip>
      </section>

      {/* 10 · RESPONDER */}
      <section ref={setSectionRef("responder")} className="manual-section" id="responder">
        <SectionHeader icon="✍️" iconClass="manual-section-icon--teal" title="Responder Mensagens"
          subtitle="Boas práticas para responder clientes" />
        <Card title="✅ Boas práticas">
          <Ul items={[
            "Cumprimente o cliente de forma <strong>educada</strong>",
            "<strong>Leia o histórico</strong> antes de responder",
            "Evite respostas duplicadas",
            "Confira se está respondendo o <strong>cliente correto</strong>",
            "Use linguagem <strong>clara e profissional</strong>",
            "Não finalize antes de resolver a solicitação",
            "Quando precisar verificar algo, informe o cliente que está analisando",
          ]} />
        </Card>
        <Quote>
          "Olá! Estou verificando para você e já retorno com a informação correta."
        </Quote>
      </section>

      {/* 11 · ORDEM MENSAGENS */}
      <section ref={setSectionRef("ordem-mensagens")} className="manual-section" id="ordem-mensagens">
        <SectionHeader icon="📋" iconClass="manual-section-icon--gray" title="Ordem das Mensagens"
          subtitle="Como conferir se as mensagens estão corretas" />
        <Card title="📋 O que conferir">
          <Ul items={[
            "Se a mensagem enviada aparece na conversa",
            "Se a resposta do cliente chegou em tempo real",
            "Se as mensagens antigas estão na ordem correta",
            "Se não existem mensagens duplicadas",
            "Se o horário exibido está correto",
          ]} />
        </Card>
      </section>

      {/* 12 · TEMPO REAL */}
      <section ref={setSectionRef("tempo-real")} className="manual-section" id="tempo-real">
        <SectionHeader icon="⚡" iconClass="manual-section-icon--yellow" title="Mensagens em Tempo Real"
          subtitle="Como o sistema atualiza automaticamente" />
        <Card title="⚡ O que deve acontecer em tempo real">
          <Ul items={[
            "Nova mensagem do cliente aparece <strong>sem atualizar a página</strong>",
            "Atendimento finalizado sai da fila ativa",
            "Atendimento reaberto volta para a fila correta",
            "Transferência aparece para o atendente de destino",
            "Contadores atualizam corretamente",
            "Status da conversa muda automaticamente",
          ]} />
        </Card>
        <Tip variant="orange" icon="⚠️">
          Caso a tela não atualize, <strong>atualize a página</strong> (F5) e comunique o responsável pelo sistema.
        </Tip>
      </section>

      {/* 13 · ANEXOS */}
      <section ref={setSectionRef("anexos")} className="manual-section" id="anexos">
        <SectionHeader icon="📎" iconClass="manual-section-icon--pink" title="Envio de Anexos e Mídias"
          subtitle="Imagens, documentos, áudios e arquivos" />
        <BtnGrid items={[
          { label: "🖼️ Imagens", desc: "Galeria, câmera, colar (Ctrl+V) ou arrastar e soltar na conversa" },
          { label: "📄 Documentos / PDFs", desc: "Selecione o arquivo pelo botão de anexo (+)" },
          { label: "🎤 Áudios", desc: "Segure o microfone para gravar. Solte para enviar" },
          { label: "💰 Comprovantes", desc: "Envie comprovantes de pagamento e arquivos relacionados ao atendimento" },
        ]} />
        <Tip variant="orange" icon="⚠️">
          Antes de enviar, confira se o arquivo pertence ao <strong>cliente correto</strong>.
        </Tip>
      </section>

      {/* 14 · RESPOSTAS RÁPIDAS */}
      <section ref={setSectionRef("respostas-rapidas")} className="manual-section" id="respostas-rapidas">
        <SectionHeader icon="⚡" iconClass="manual-section-icon--purple" title="Respostas Rápidas"
          subtitle="Mensagens prontas para padronizar o atendimento" />
        <Card title="⚡ Para que servem">
          <Ul items={[
            "Saudação", "Solicitação de dados", "Informações financeiras",
            "Orientação de suporte", "Confirmação de pagamento",
            "Encerramento", "Avaliação do atendimento",
          ]} />
        </Card>
        <Steps items={[
          "No campo de mensagem, digite <strong>/</strong> (barra) para abrir o seletor",
          "Escolha a resposta desejada — o texto é inserido automaticamente",
          "Personalize a mensagem quando necessário e pressione Enter para enviar",
        ]} />
        <Tip>
          Gerencie suas respostas em <strong>Respostas</strong> no menu lateral (ícone 📄).
          Mesmo usando respostas rápidas, personalize quando necessário.
        </Tip>
      </section>

      {/* 15 · TAGS */}
      <section ref={setSectionRef("tags")} className="manual-section" id="tags">
        <SectionHeader icon="🏷️" iconClass="manual-section-icon--yellow" title="Tags e Identificações"
          subtitle="Como classificar conversas com etiquetas" />
        <Card title="🏷️ Exemplos de tags">
          <TagList tags={[
            "Financeiro", "Suporte", "Comercial", "Urgente", "Boleto",
            "Dúvida", "Implantação", "Retorno", "Aguardando pagamento", "Negociação",
          ]} />
        </Card>
        <Steps items={[
          "Abra a conversa e <strong>assuma</strong> o atendimento",
          "Clique em <strong>Tags</strong> no cabeçalho ou no painel lateral do cliente",
          "Clique na tag desejada para aplicar. Clique novamente para remover",
        ]} />
        <Tip>
          Tags são criadas pelo supervisor/admin. Como atendente, você aplica e remove tags existentes.
          Use com cuidado para facilitar consultas futuras.
        </Tip>
      </section>

      {/* 16 · SETORES */}
      <section ref={setSectionRef("setores")} className="manual-section" id="setores">
        <SectionHeader icon="🏢" iconClass="manual-section-icon--blue" title="Setores e Departamentos"
          subtitle="Como os setores organizam os atendimentos" />
        <Card title="🏢 Setores comuns">
          <TagList tags={[
            "Comercial", "Suporte", "Financeiro", "Administrativo",
            "Pós-venda", "Cotações", "Sinistros", "Renovações", "Atendimento geral",
          ]} />
        </Card>
        <Card>
          Cada conversa pode ser direcionada para um setor. O atendente visualiza somente as conversas
          permitidas para seu usuário e setor, conforme as regras definidas pelo administrador.
        </Card>
      </section>

      {/* 17 · TRANSFERIR */}
      <section ref={setSectionRef("transferir")} className="manual-section" id="transferir">
        <SectionHeader icon="↔️" iconClass="manual-section-icon--orange" title="Transferir Atendimento"
          subtitle="Como passar uma conversa para outro atendente ou setor" />
        <Steps items={[
          "Abra a conversa e clique em <strong>Transferir</strong>",
          "Escolha o <strong>setor</strong> ou <strong>atendente</strong> correto",
          "Informe o motivo, quando necessário",
          "Registre uma observação interna, se o sistema permitir",
          "Avise o cliente quando fizer sentido",
        ]} />
        <Quote>"Vou encaminhar seu atendimento para o setor responsável, tudo bem?"</Quote>
        <Tip variant="orange" icon="⚠️">
          Não transfira sem contexto. Conversas transferidas aparecem em <strong>Minhas Pendências → Transferidos</strong>.
        </Tip>
      </section>

      {/* 18 · GRUPOS */}
      <section ref={setSectionRef("grupos")} className="manual-section" id="grupos">
        <SectionHeader icon="👥" iconClass="manual-section-icon--green" title="Grupos de WhatsApp"
          subtitle="Regras para atendimento em grupos vinculados a setores" />
        <Card title="📋 Regras importantes">
          <Ul items={[
            "O grupo aparece apenas para o <strong>setor/departamento vinculado</strong>",
            "Grupos não devem aparecer para atendentes sem permissão",
            "Cards de grupos permanecem separados das regras normais de atendimento individual",
            "Grupos podem <strong>não ter</strong> botões de assumir, encerrar ou transferir",
            "Grupos fixados por setor <strong>não interferem</strong> nas pendências reais do atendente",
          ]} />
        </Card>
        <Tip variant="orange" icon="⚠️">
          Trate grupos com atenção — as mensagens são visíveis para mais pessoas.
        </Tip>
      </section>

      {/* 19 · PENDÊNCIAS */}
      <section ref={setSectionRef("pendencias")} className="manual-section" id="pendencias">
        <SectionHeader icon="📋" iconClass="manual-section-icon--red" title="Minhas Pendências"
          subtitle="O que depende de ação imediata sua" />
        <StatusGrid items={[
          { color: "em_atendimento", name: "Transferidos para você", desc: "Conversas transferidas. O cliente está esperando!" },
          { color: "aguardando", name: "Aguardando sua resposta", desc: "Conversas onde você marcou aguardar e o cliente já respondeu." },
          { color: "atraso", name: "Em atraso (+30 min)", desc: "Conversas paradas há mais de 30 minutos sem sua resposta." },
        ]} />
        <Tip variant="orange" icon="🔔">
          <strong>Não considera como pendência</strong> as conversas em "Aguardando cliente" — nesse caso a
          próxima ação depende do cliente. Verifique este card ao iniciar o turno e periodicamente.
        </Tip>
      </section>

      {/* 20 · HISTÓRICO */}
      <section ref={setSectionRef("historico")} className="manual-section" id="historico">
        <SectionHeader icon="📜" iconClass="manual-section-icon--gray" title="Histórico da Conversa"
          subtitle="Por que ler o histórico antes de responder" />
        <Card title="📜 O histórico ajuda a entender">
          <Ul items={[
            "O que o cliente pediu",
            "Quem atendeu anteriormente",
            "Qual foi a última resposta",
            "Se houve transferência",
            "Se o atendimento foi finalizado",
            "Se existe negociação, cobrança ou suporte em andamento",
          ]} />
        </Card>
        <Tip variant="blue" icon="ℹ️">
          Quando houver muitas mensagens antigas, use o botão para <strong>carregar mensagens antigas</strong>
          daquele contato. Carregue somente quando necessário, para evitar lentidão.
        </Tip>
      </section>

      {/* 21 · DADOS DO CLIENTE */}
      <section ref={setSectionRef("dados-cliente")} className="manual-section" id="dados-cliente">
        <SectionHeader icon="👤" iconClass="manual-section-icon--blue" title="Dados do Cliente"
          subtitle="Informações disponíveis no painel lateral" />
        <DataTable
          headers={["Dado", "Descrição"]}
          rows={[
            ["Nome", "Nome completo ou apelido do cliente"],
            ["Telefone", "Número de WhatsApp"],
            ["Empresa", "Razão social ou nome fantasia"],
            ["CPF/CNPJ", "Documento cadastrado"],
            ["E-mail", "E-mail de contato"],
            ["Cidade", "Localização do cliente"],
            ["Setor relacionado", "Departamento vinculado"],
            ["Histórico", "Atendimentos anteriores"],
            ["Observações", "Notas registradas"],
            ["Tags", "Etiquetas aplicadas"],
            ["Responsável anterior", "Último atendente"],
          ]}
        />
        <Tip variant="orange" icon="⚠️">
          Antes de tratar assuntos financeiros, fiscais ou sensíveis, confirme que está falando com a
          <strong> pessoa correta</strong>.
        </Tip>
      </section>

      {/* 22 · OBSERVAÇÕES */}
      <section ref={setSectionRef("observacoes")} className="manual-section" id="observacoes">
        <SectionHeader icon="📝" iconClass="manual-section-icon--purple" title="Observações Internas"
          subtitle="Notas privadas visíveis apenas para a equipe" />
        <Card title="📝 Exemplos de observações">
          <Ul items={[
            "\"Cliente solicitou retorno amanhã.\"",
            "\"Aguardando comprovante.\"",
            "\"Encaminhado para financeiro.\"",
            "\"Cliente pediu negociação.\"",
            "\"Verificar com suporte técnico.\"",
          ]} />
        </Card>
        <Tip>
          Observações servem para orientar a equipe e <strong>nunca são enviadas ao cliente</strong>.
          Registre no painel lateral do cliente após assumir o atendimento.
        </Tip>
      </section>

      {/* 23 · FINALIZAR */}
      <section ref={setSectionRef("finalizar")} className="manual-section" id="finalizar">
        <SectionHeader icon="✖️" iconClass="manual-section-icon--red" title="Finalizar Atendimento"
          subtitle="Quando e como encerrar corretamente" />
        <Card title="✅ Antes de finalizar, confirme">
          <Checklist items={[
            "Respondeu a última mensagem do cliente",
            "Resolveu a solicitação",
            "Registrou informações importantes",
            "Aplicou as tags corretas",
            "Transferiu corretamente, se necessário",
            "Cliente recebeu a orientação final",
          ]} />
        </Card>
        <Quote>
          "Atendimento finalizado com sucesso. Segue seu protocolo: {"{{protocolo}}"}. Por favor, informe uma nota de 0 a 10 para avaliar nosso atendimento."
        </Quote>
        <Quote>
          "Atendimento finalizado com sucesso. Segue seu protocolo: {"{{protocolo}}"}. Por favor, informe uma nota de 0 a 10 para avaliar nosso atendimento. Sua opinião é muito importante para nós. Se puder, avalie também pelo link: {"{{link_avaliacao}}"}. "
        </Quote>
      </section>

      {/* 24 · PROTOCOLO */}
      <section ref={setSectionRef("protocolo")} className="manual-section" id="protocolo">
        <SectionHeader icon="🔢" iconClass="manual-section-icon--teal" title="Protocolo de Atendimento"
          subtitle="Identificação única de cada atendimento" />
        <Card title="🔢 Para que serve o protocolo">
          <Ul items={[
            "Consultas futuras do cliente",
            "Reclamações e auditoria",
            "Histórico e controle interno",
            "Comprovação do atendimento realizado",
          ]} />
        </Card>
        <Tip>
          Informe o protocolo ao cliente quando o sistema gerar esse número ao finalizar o atendimento.
        </Tip>
      </section>

      {/* 25 · AVALIAÇÃO */}
      <section ref={setSectionRef("avaliacao")} className="manual-section" id="avaliacao">
        <SectionHeader icon="⭐" iconClass="manual-section-icon--yellow" title="Avaliação do Atendimento"
          subtitle="Como funciona a nota de 0 a 10" />
        <Card>
          Após o encerramento, o cliente pode receber uma solicitação de avaliação com nota de
          <strong> 0 a 10</strong>. Essa nota ajuda a empresa a medir a qualidade do atendimento.
        </Card>
        <Tip>
          Mantenha um atendimento educado, claro e objetivo para aumentar a satisfação do cliente.
        </Tip>
      </section>

      {/* 26 · REABRIR */}
      <section ref={setSectionRef("reabrir")} className="manual-section" id="reabrir">
        <SectionHeader icon="🔄" iconClass="manual-section-icon--green" title="Reabrir Atendimento"
          subtitle="Quando e como reabrir uma conversa finalizada" />
        <Card title="🔄 Quando reabrir">
          <Ul items={[
            "O cliente manda nova mensagem",
            "O atendente precisa continuar o atendimento",
            "Houve encerramento incorreto",
            "O cliente retornou com nova dúvida",
          ]} />
        </Card>
        <Card>
          Ao reabrir, a conversa volta para o status correto e aparece novamente na fila de atendimento adequada.
          Clique em <strong>Reabrir</strong> no cabeçalho da conversa finalizada.
        </Card>
      </section>

      {/* 27 · FINANCEIRO */}
      <section ref={setSectionRef("financeiro")} className="manual-section" id="financeiro">
        <SectionHeader icon="💰" iconClass="manual-section-icon--orange" title="Atendimento Financeiro"
          subtitle="Boletos, pagamentos, negociações e cobranças" />
        <Card title="💰 Assuntos comuns">
          <Ul items={[
            "Boletos e segunda via", "Pagamentos e comprovantes",
            "Negociações e vencimentos", "Pendências e liberação de sistema",
          ]} />
        </Card>
        <Quote>
          "Conforme negociação realizada, o valor ficou em R$ 599,00 com vencimento todo dia 20. Você está ciente e de acordo com essa condição?"
        </Quote>
        <Tip variant="orange" icon="⚠️">
          Antes de enviar valores ou cobranças, confira se os dados estão <strong>corretos</strong>.
        </Tip>
      </section>

      {/* 28 · SUPORTE */}
      <section ref={setSectionRef("suporte")} className="manual-section" id="suporte">
        <SectionHeader icon="🔧" iconClass="manual-section-icon--blue" title="Atendimento de Suporte"
          subtitle="Como tratar dúvidas e problemas técnicos" />
        <Card title="🔧 Boas práticas">
          <Ul items={[
            "Perguntar o que ocorreu antes de orientar",
            "Solicitar prints, se necessário",
            "Verificar qual módulo está sendo usado",
            "Confirmar se o erro acontece em uma máquina ou em todas",
            "Registrar o problema nas observações internas",
            "Encaminhar para o setor técnico quando necessário",
          ]} />
        </Card>
        <Quote>
          "Pode me enviar um print da tela e informar em qual módulo isso acontece? Assim consigo analisar melhor."
        </Quote>
      </section>

      {/* 29 · COMERCIAL */}
      <section ref={setSectionRef("comercial")} className="manual-section" id="comercial">
        <SectionHeader icon="💼" iconClass="manual-section-icon--purple" title="Atendimento Comercial"
          subtitle="Como identificar a necessidade do cliente" />
        <Card title="💼 Perguntas importantes">
          <Ul items={[
            "Qual tipo de empresa ele possui?",
            "Quantos usuários irão usar?",
            "Quais módulos precisa?",
            "Se já utiliza outro sistema?",
            "Qual a maior dificuldade hoje?",
            "Se deseja demonstração?",
          ]} />
        </Card>
        <Tip>
          O objetivo é <strong>entender a necessidade</strong> antes de oferecer a solução.
        </Tip>
      </section>

      {/* 30 · POR SETOR */}
      <section ref={setSectionRef("por-setor")} className="manual-section" id="por-setor">
        <SectionHeader icon="🏗️" iconClass="manual-section-icon--gray" title="Atendimento por Setor"
          subtitle="Responsabilidades de cada departamento" />
        <DataTable
          headers={["Setor", "Responsabilidades"]}
          rows={[
            ["<strong>Comercial</strong>", "Novos clientes, demonstração, planos, contratação, renovação, propostas"],
            ["<strong>Financeiro</strong>", "Boletos, pagamentos, negociação, liberação, cobrança, segunda via"],
            ["<strong>Suporte</strong>", "Dúvidas do sistema, erros, configurações, orientações técnicas, chamados"],
            ["<strong>Pós-venda</strong>", "Acompanhamento, satisfação, treinamento, retenção, relacionamento"],
          ]}
        />
        <Tip>
          Cada setor responde apenas aquilo que faz parte da sua responsabilidade. Transfira quando necessário.
        </Tip>
      </section>

      {/* 31 · CHATBOT */}
      <section ref={setSectionRef("chatbot")} className="manual-section" id="chatbot">
        <SectionHeader icon="🤖" iconClass="manual-section-icon--purple" title="Chatbot e Triagem"
          subtitle="Como o bot direciona o cliente antes do atendente" />
        <Card title="🤖 O que verificar quando houver chatbot">
          <Ul items={[
            "Qual opção o cliente escolheu no bot",
            "Qual setor foi definido pela triagem",
            "Qual foi a mensagem inicial",
            "Se o cliente já informou dados importantes",
          ]} />
        </Card>
        <Tip variant="orange" icon="⚠️">
          Não ignore as informações coletadas pelo bot — elas economizam tempo no atendimento.
        </Tip>
      </section>

      {/* 32 · ADMINISTRADOR */}
      <section ref={setSectionRef("administrador")} className="manual-section" id="administrador">
        <SectionHeader icon="👁️" iconClass="manual-section-icon--gray" title="Controle do Administrador"
          subtitle="O que o sistema registra sobre suas ações" />
        <Card title="👁️ O sistema registra">
          <Ul items={[
            "Quem respondeu e em que horário",
            "Quem assumiu o atendimento",
            "Quem transferiu e para quem",
            "Quem finalizou",
            "Tempo de resposta",
            "Histórico completo de atendimento",
            "Status da conversa em cada momento",
          ]} />
        </Card>
        <Tip variant="blue" icon="ℹ️">
          Isso ajuda na gestão, qualidade e organização da equipe. Atue sempre com profissionalismo.
        </Tip>
      </section>

      {/* 33 · BOAS PRÁTICAS */}
      <section ref={setSectionRef("boas-praticas")} className="manual-section" id="boas-praticas">
        <SectionHeader icon="✨" iconClass="manual-section-icon--green" title="Boas Práticas de Atendimento"
          subtitle="O que fazer para manter qualidade" />
        <Checklist items={[
          "Responder com <strong>educação</strong>",
          "Usar linguagem <strong>simples</strong>",
          "Evitar abreviações confusas",
          "Não discutir com o cliente",
          "Não deixar cliente sem retorno",
          "Não finalizar atendimento sem resolver",
          "Conferir o histórico antes de responder",
          "Usar tags corretamente",
          "Transferir somente quando necessário",
          "Registrar observações importantes",
          "Manter a conversa organizada",
        ]} />
      </section>

      {/* 34 · NÃO FAZER */}
      <section ref={setSectionRef("nao-fazer")} className="manual-section" id="nao-fazer">
        <SectionHeader icon="🚫" iconClass="manual-section-icon--red" title="O que o Atendente NÃO Deve Fazer"
          subtitle="Erros que comprometem a qualidade do atendimento" />
        <div className="manual-dont-list">
          {[
            "Assumir atendimento que não irá responder",
            "Finalizar atendimento pendente",
            "Transferir sem explicar o contexto",
            "Enviar mensagem para cliente errado",
            "Apagar ou ignorar histórico",
            "Compartilhar login com colegas",
            "Usar linguagem grosseira",
            "Responder sem ler o contexto",
            "Deixar conversa parada sem motivo",
            "Marcar como resolvido algo que não foi resolvido",
          ].map((item, i) => (
            <div key={i} className="manual-dont-item">
              <span className="manual-dont-icon">🚫</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 35 · PRIORIDADE */}
      <section ref={setSectionRef("prioridade")} className="manual-section" id="prioridade">
        <SectionHeader icon="🔥" iconClass="manual-section-icon--orange" title="Prioridade de Atendimento"
          subtitle="Ordem correta para tratar as conversas" />
        <PriorityList items={[
          "<strong>Conversas aguardando resposta do atendente</strong> — cliente esperando agora",
          "<strong>Conversas transferidas para o atendente</strong> — colega passou para você",
          "<strong>Conversas em atraso</strong> — paradas há mais de 30 minutos",
          "<strong>Conversas não lidas</strong> — mensagens ainda não visualizadas",
          "<strong>Conversas abertas</strong> — na fila aguardando assumir",
          "<strong>Conversas em atendimento</strong> — já sendo atendidas",
          "<strong>Conversas aguardando cliente</strong> — próxima ação é do cliente",
          "<strong>Conversas finalizadas</strong> — apenas para consulta",
        ]} />
      </section>

      {/* 36 · PEDIR AJUDA */}
      <section ref={setSectionRef("pedir-ajuda")} className="manual-section" id="pedir-ajuda">
        <SectionHeader icon="🆘" iconClass="manual-section-icon--red" title="Quando Pedir Ajuda"
          subtitle="Situações que exigem apoio de colega ou supervisor" />
        <Card title="🆘 Peça ajuda quando">
          <Ul items={[
            "Não souber responder",
            "O cliente estiver insatisfeito",
            "Houver problema técnico complexo",
            "Envolver cobrança delicada",
            "Envolver cancelamento",
            "Envolver erro fiscal",
            "Precisar de autorização especial",
            "O cliente pedir supervisor ou responsável",
          ]} />
        </Card>
        <Tip>
          Use <strong>Transferir</strong> ou <strong>Atendimento Compartilhado</strong> conforme o recurso disponível.
          No Chat Interno, chame o supervisor diretamente.
        </Tip>
      </section>

      {/* 37 · CONFERÊNCIA */}
      <section ref={setSectionRef("conferencia")} className="manual-section" id="conferencia">
        <SectionHeader icon="✔️" iconClass="manual-section-icon--green" title="Conferência Antes de Finalizar"
          subtitle="Checklist obrigatório antes de encerrar" />
        <Checklist title="✔️ Confirme antes de finalizar:" items={[
          "O cliente foi respondido",
          "A solicitação foi resolvida",
          "Não há mensagem pendente",
          "As tags estão corretas",
          "O setor está correto",
          "O histórico ficou claro",
          "O protocolo foi informado",
          "A avaliação foi solicitada, quando configurada",
        ]} />
      </section>

      {/* 38 · PROBLEMAS */}
      <section ref={setSectionRef("problemas")} className="manual-section" id="problemas">
        <SectionHeader icon="❓" iconClass="manual-section-icon--yellow" title="Problemas Comuns e Como Agir"
          subtitle="Soluções para situações frequentes" />
        <DataTable
          headers={["Problema", "O que fazer"]}
          rows={[
            ["Cliente enviou mensagem e não apareceu", "Atualize a tela (F5) e verifique o filtro atual. Se continuar, comunique o responsável."],
            ["Atendimento sumiu da fila", "Verifique se foi finalizado, transferido ou mudou de status."],
            ["Cliente aparece em outro setor", "Verifique se houve triagem automática ou transferência."],
            ["Mensagem ficou fora de ordem", "Confira o horário das mensagens e comunique o suporte interno."],
            ["Busca não encontrou o cliente", "Tente buscar por parte do nome, telefone sem máscara ou últimos dígitos."],
            ["Conversei com o cliente errado", "Avise imediatamente o responsável e registre a situação."],
          ]}
        />
      </section>

      {/* 39 · PRODUÇÃO */}
      <section ref={setSectionRef("producao")} className="manual-section" id="producao">
        <SectionHeader icon="🏭" iconClass="manual-section-icon--gray" title="Regras Importantes para Produção"
          subtitle="Conferências diárias para garantir qualidade" />
        <Checklist title="🏭 Confira diariamente:" items={[
          "Se sua fila está correta",
          "Se as mensagens chegam em tempo real",
          "Se os filtros estão funcionando",
          "Se as conversas finalizadas saem da fila",
          "Se as conversas reabertas voltam para atendimento",
          "Se as transferências aparecem corretamente",
          "Se as mensagens estão em ordem",
          "Se os status estão corretos",
          "Se os grupos aparecem apenas para quem tem permissão",
          "Se os clientes conseguem avaliar o atendimento",
        ]} />
      </section>

      {/* 40 · FLUXO IDEAL */}
      <section ref={setSectionRef("fluxo-ideal")} className="manual-section" id="fluxo-ideal">
        <SectionHeader icon="🔄" iconClass="manual-section-icon--teal" title="Resumo do Fluxo Ideal"
          subtitle="Passo a passo completo de um atendimento do início ao fim" />
        <Steps items={[
          "Cliente chama no WhatsApp",
          "Chatbot ou sistema direciona para o setor correto",
          "Conversa aparece na fila correta",
          "Atendente assume ou recebe o atendimento",
          "Atendente lê o histórico",
          "Atendente responde o cliente",
          "Se necessário, usa tags, observações, transferência ou atendimento compartilhado",
          "Atendimento fica aguardando cliente ou aguardando atendente, conforme a próxima ação",
          "Solicitação é resolvida",
          "Atendente finaliza",
          "Cliente recebe protocolo e avaliação",
          "Histórico fica salvo para futuras consultas",
        ]} />
      </section>

      {/* 41 · CHECKLIST */}
      <section ref={setSectionRef("checklist")} className="manual-section" id="checklist">
        <SectionHeader icon="☑️" iconClass="manual-section-icon--green" title="Checklist do Atendente"
          subtitle="Rotina diária completa" />

        <SubSection title="☀️ Antes de iniciar o dia">
          <Checklist items={[
            "Entrar com seu <strong>próprio login</strong>",
            "Conferir <strong>Minha fila</strong>",
            "Conferir <strong>Não lidas</strong>",
            "Conferir <strong>Minhas Pendências</strong>",
            "Conferir atendimentos <strong>transferidos</strong>",
            "Conferir conversas em <strong>atraso</strong>",
          ]} />
        </SubSection>

        <SubSection title="💬 Durante o atendimento">
          <Checklist items={[
            "Ler o histórico antes de responder",
            "Responder com clareza e educação",
            "Usar tags corretas",
            "Registrar observações quando necessário",
            "Transferir apenas quando fizer sentido",
            "Não deixar cliente sem retorno",
          ]} />
        </SubSection>

        <SubSection title="✅ Antes de finalizar">
          <Checklist items={[
            "Confirmar se resolveu a solicitação",
            "Conferir se não há mensagem pendente",
            "Informar o protocolo ao cliente",
            "Solicitar avaliação",
            "Finalizar corretamente",
          ]} />
        </SubSection>
      </section>

    </>
  );
}
