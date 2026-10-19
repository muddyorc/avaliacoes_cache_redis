# Sistema Web de Gerenciamento e Auxílio à Correção de Avaliações Digitais e Monitoramento Anticola

Plataforma web em que o professor cria, aplica e acompanha avaliações digitais, e o estudante
as realiza pelo navegador, com salvamento automático das respostas.

Trabalho Final de Curso II — Universidade de Rio Verde, Faculdade de Engenharia de Software (2026).
Autor: Julio Cezar Rodrigues Correia. Orientador: Prof. Esp. Vinícius Félix de Paula.

## Sobre o projeto

O processo de avaliação costuma ficar espalhado por várias ferramentas: editor de texto para
escrever as questões, ambiente virtual para aplicar a prova e planilha para analisar as notas.
Este sistema reúne o ciclo inteiro em um só lugar:

- um **banco de questões** reutilizável, com objetivas e discursivas;
- **avaliações** montadas a partir desse banco, com período, duração e regras de aplicação;
- **turmas** com código de acesso, de entrada direta ou mediante aprovação do professor;
- **realização da prova** com cronômetro controlado pelo servidor e salvamento automático;
- **correção** automática das objetivas e correção assistida por **Inteligência Artificial**
  nas discursivas, sempre com a palavra final do professor;
- **resultados e indicadores** de desempenho, da nota de um estudante ao panorama da turma.

Como diferencial, o sistema registra eventos do navegador durante a prova — troca de aba, perda
de foco e atalhos de teclado — para dar ao professor informações sobre a execução da avaliação,
em linguagem neutra e sem acusações automáticas.

## Estado atual

Desenvolvimento incremental, uma etapa por vez. **Os treze requisitos funcionais estão
implementados**: o ciclo funciona de ponta a ponta, da criação da questão até a nota liberada
ao estudante, passando pelo monitoramento da prova e pela correção assistida por IA.

| Requisito | O que faz | Situação |
|---|---|---|
| RF01 | Autenticar usuários, recuperar senha, registrar acessos | ✅ |
| RF02 | Gerenciar usuários e perfis; autocadastro do estudante | ✅ |
| RF03 | Criar avaliações | ✅ |
| RF04 | Editar, publicar, arquivar, duplicar e excluir avaliações | ✅ |
| RF05 | Gerenciar o banco de questões | ✅ |
| RF06 | Gerenciar turmas e o ingresso por código | ✅ |
| RF07 | Vincular avaliações às turmas | ✅ |
| RF08 | Realizar avaliações | ✅ |
| RF09 | Salvar respostas automaticamente | ✅ |
| RF10 | Monitorar a integridade da avaliação | ✅ |
| RF11 | Corrigir e auxiliar na correção, com sugestão de nota por IA | ✅ |
| RF12 | Dashboard de desempenho | ✅ |
| RF13 | Consultar resultados | ✅ |

**453 testes automatizados**, todos passando — 431 no backend e 22 no frontend —, além de
roteiros de verificação no navegador a cada etapa. Falta a etapa de finalização: revisão de
segurança, verificação nos navegadores Chromium e build de produção.

## Funcionalidades por perfil

**Professor**
- Banco de questões: objetivas (2 a 10 alternativas, exatamente uma correta) e discursivas
  (critérios de correção e, se o professor quiser, uma resposta esperada), organizadas por tema.
- Avaliações: título, instruções, período, duração, monitoramento e questões do banco — ou
  criadas na hora, indo também para o banco.
- Publicação com verificação de pendências; arquivar, duplicar e excluir logicamente.
- Turmas com código de acesso; aprovar ou recusar solicitações de entrada.
- **Fazer a própria prova como teste**, com cronômetro e correção, sem gravar nada.
- Correção: as objetivas o sistema corrige sozinho; nas discursivas, a **IA analisa a resposta
  ao abrir a prova** e sugere nota com justificativa — o professor **aprova** ou **recusa**, e
  recusar devolve a correção manual daquela questão. A nota nunca é atribuída sozinha. A nota
  só chega ao estudante quando o professor **libera os resultados**.
- Monitoramento da prova: perda de foco, troca de aba e atalhos de teclado, com limite
  opcional de ocorrências. O relatório vem com o aviso de leitura **antes** dos números — os
  registros descrevem o que o navegador observou, não acusam ninguém.
- Resultados por turma: um quadro estudante × avaliação, com quem ainda não fez, o que falta
  corrigir e o histórico de cada estudante, prova por prova.
- Dashboard de desempenho: média, mediana, distribuição das notas, estudantes abaixo da média e
  o índice de acerto de cada questão — por avaliação ou por turma. Cada gráfico vem com a
  tabela dos mesmos números, e o que ainda não tem dado é dito com todas as letras, em vez de
  aparecer como zero.

**Estudante**
- Autocadastro e edição dos próprios dados.
- Entrada em turmas pelo código.
- Realização da prova com cronômetro, salvamento automático e retomada após queda de conexão.
- Aviso, antes de começar, do que a prova registra e do que o sistema **não** vê.
- Nota da prova, quando o professor libera os resultados, e — se ele marcar — a correção
  questão a questão e indicadores anônimos da turma.
- Cancelamento da própria inscrição na turma.

**Administrador**
- Cadastro, edição, ativação e inativação de contas; definição de perfis.

## Decisões de projeto que valem destacar

- **Nenhum registro é apagado.** Usuários, turmas, questões, avaliações, tentativas e respostas
  são inativados, arquivados ou marcados como excluídos — o histórico é sempre preservado.
- **A autorização acontece no servidor.** Esconder um botão não protege nada: cada rota confere
  perfil e propriedade. O gabarito nunca é enviado ao estudante.
- **O tempo da prova é do servidor.** O prazo é `min(início + duração, fim do período)`, gravado
  no banco. O cronômetro da tela é apenas um visor; mudar o relógio do computador não muda nada.
- **Uma tentativa por estudante**, garantida por restrição no banco.
- **Depois que o primeiro estudante inicia**, a avaliação fica estruturalmente bloqueada: o
  professor pode consultar, arquivar e duplicar, mas não alterar.
- **Sessão em cookie `httpOnly`**, nunca em `localStorage`; senhas apenas como hash `bcrypt`;
  tokens de recuperação guardados só como hash, com validade e uso único.
- **A IA sugere, o professor decide.** Entre a sugestão e a nota registrada existe sempre um
  clique do professor. A resposta do modelo é validada antes de chegar à tela: nota fora do
  intervalo da questão é descartada, não ajustada.
- **Nada que identifique o estudante sai do sistema.** O que vai para a IA é o enunciado, o
  tema, os critérios e a resposta — nome, e-mail e identificador não são nem parâmetros da
  função. A resposta do estudante viaja entre delimitadores, e a instrução manda ignorar
  ordens vindas de dentro dela.
- **Nenhum teste automatizado consulta a IA.** Uma trava substitui o `fetch` global nos testes
  e recusa qualquer saída para a internet: a suíte não gasta crédito nem depende da resposta
  de um modelo, que varia entre chamadas.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 8 + React Router 7, JavaScript, CSS puro; `recharts` nos gráficos |
| Backend | Node.js 22+ e Express 5, JavaScript (ESM) |
| Banco | PostgreSQL 16 ou superior, SQL puro com `pg`, migrações `.sql` numeradas |
| Sessão | JWT em cookie `httpOnly`, senhas com `bcryptjs` |
| Validação | `zod`; proteção contra abuso com `express-rate-limit`; e-mail com `nodemailer` |
| IA | OpenAI (GPT), Google (Gemini) ou Anthropic (Claude), escolhidos por variável de ambiente; sem chave, um provedor simulado que anuncia a simulação |
| Testes | `node:test` e `supertest`, em banco separado do de desenvolvimento |

```
Navegador (React) ──/api (mesma origem)──► API Express ──► PostgreSQL
```

## Como executar

### Pré-requisitos

- Node.js 22 ou superior
- PostgreSQL 16 ou superior

> Docker não é necessário. O `docker-compose.yml` continua no repositório, mas não é mantido.

### 1. Configurar

```bash
git clone https://github.com/muddyorc/TFC.git
cd TFC
cp .env.example .env
```

Edite o `.env`. O arquivo **nunca** é versionado; o repositório traz apenas o `.env.example`
com os nomes das variáveis. Defina no mínimo:

| Variável | O que colocar |
|---|---|
| `DATABASE_URL` | Conexão do banco de desenvolvimento |
| `DATABASE_URL_TESTE` | Conexão do banco **de testes** — precisa ser outro banco |
| `JWT_SECRET` | Valor longo e aleatório |
| `ADMIN_SENHA` | Senha do administrador inicial (mínimo de 8 caracteres) |

Para a correção assistida por IA, opcionalmente:

| Variável | O que colocar |
|---|---|
| `IA_PROVEDOR` | `openai`, `gemini`, `anthropic` ou `simulado` (padrão) |
| `IA_API_KEY` | A chave do provedor escolhido |
| `IA_MODELO` | Opcional; sem ela, cada provedor usa o modelo padrão do código |

Sem chave, o sistema usa o provedor **simulado**: o fluxo de aprovar e recusar funciona igual,
e a justificativa diz, com todas as letras, que a sugestão não veio de uma IA.

```bash
# Gera um JWT_SECRET
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

### 2. Criar os bancos

Com um superusuário do PostgreSQL:

```sql
CREATE ROLE avaliacoes LOGIN PASSWORD 'a_senha_que_voce_escolheu';
CREATE DATABASE avaliacoes       OWNER avaliacoes ENCODING 'UTF8';
CREATE DATABASE avaliacoes_teste OWNER avaliacoes ENCODING 'UTF8';

-- Permite que `npm test` recrie o banco de testes sozinho.
ALTER ROLE avaliacoes CREATEDB;
```

### 3. Executar

```bash
# Terminal 1 — API
cd backend
npm install
npm run setup      # aplica as migrações e cria o administrador inicial
npm run dev        # http://localhost:3000

# Terminal 2 — interface
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Abra http://localhost:5173 e entre com o administrador definido no `.env`. Por ele, cadastre um
professor; o estudante pode criar a própria conta pelo link **Criar conta**.

## Testes

```bash
cd backend
npm test           # 431 testes (integração + unitários), ~7 min
npm run test:unit  # só os unitários, sem banco, ~1 s

cd ../frontend
npm test           # 22 unitários
```

Os testes rodam **sempre em um banco separado** (`DATABASE_URL_TESTE`) e apagam os dados dele a
cada execução. O script recusa executar se `NODE_ENV` não for `test` ou se a URL de teste for
igual à de desenvolvimento, e cria o banco de testes caso não exista. O banco de desenvolvimento
nunca é tocado — há um teste (`tests/isolamento.test.js`) que verifica exatamente isso.

> Não rode `node --test` diretamente: sem `npm test` o ambiente de teste não é montado — e
> entre o que ele monta está a trava que impede qualquer teste de sair para a internet.

Há também um teste de estresse por cenário (`npm run estresse`), que simula uma turma inteira
fazendo a prova ao mesmo tempo, e análise estática nos dois pacotes (`npm run lint`).

A verificação manual no navegador segue um roteiro próprio, que acompanha a monografia.

## Estrutura

```
├── .env.example            variáveis de ambiente necessárias
├── backend/
│   ├── migrations/         001_schema_inicial.sql até 008_modelo_da_sugestao_ia.sql
│   ├── scripts/            testar.js (prepara o banco de testes), migrate.js, estresse.js
│   ├── src/
│   │   ├── config/ db/ middleware/ utils/
│   │   ├── dominio/        funções puras (estatísticas, prazo) — a base dos testes unitários
│   │   ├── servicos/       email.js e ia/ (um adaptador por provedor + o prompt)
│   │   └── modules/        auth, usuarios, questoes, avaliacoes, turmas, realizacao,
│   │                       correcao, monitoramento, dashboard, resultados, saude
│   └── tests/              integração + unitarios/ + ajuda/sem-rede.js (trava de rede)
└── frontend/
    ├── src/                api/ auth/ componentes/ paginas/ utils/ styles/
    └── tests/              unitários das funções puras
```

Convenção do backend: um diretório por domínio, com `<modulo>.routes.js` e `<modulo>.service.js`.

## Banco de dados

- Migrações em `backend/migrations/NNN_descricao.sql`, aplicadas em ordem por `npm run migrate`
  e registradas na tabela `schema_migrations`.
- **Migração já aplicada nunca é editada**: para mudar o esquema, cria-se um arquivo novo.
- Cada migração explica, no próprio arquivo, o que muda e por quê.

## Documentação

A documentação de projeto — requisitos, arquitetura, modelo de dados, decisões técnicas e de
negócio, histórico de implementação, roteiro de verificação manual e o mapa entre o documento
de requisitos e o código — acompanha a monografia do Trabalho Final de Curso e **não é
versionada** neste repositório, por decisão do autor.

O que fica aqui, junto do código, são os comentários: cada decisão não óbvia está explicada no
arquivo em que ela vive.

## Solução de problemas

| Sintoma | Causa provável |
|---|---|
| "Variável de ambiente obrigatória ausente: JWT_SECRET" | Falta `JWT_SECRET` no `.env` (não há valor padrão, por segurança) |
| `npm test` aborta com "DATABASE_URL_TESTE aponta para o MESMO banco" | As duas URLs apontam para o mesmo banco; use um banco dedicado aos testes |
| `npm test` aborta ao criar o banco de testes | Conceda `ALTER ROLE <usuario> CREATEDB;` ou crie o banco à mão |
| Nenhum e-mail chega na recuperação de senha | Comportamento esperado sem `SMTP_HOST`: o link sai no log da API |
| HTTP 429 ao entrar | Proteção contra abuso; aguarde alguns minutos |
| `EADDRINUSE` | Outro processo usa a porta 3000, 5173 ou 5432 |
| A sugestão da IA aparece como "simulada" | Falta `IA_PROVEDOR` ou `IA_API_KEY` no `.env`. Confira em `GET /api/correcao/ia/estado`, que informa provedor e modelo sem revelar a chave |
| "Não foi possível obter a sugestão da Inteligência Artificial agora" | O log da API traz o motivo informado pelo provedor. O mais comum é nome de modelo descontinuado, que responde 404 mesmo continuando listado na conta |

## Licença e uso

Projeto acadêmico, desenvolvido como Trabalho Final de Curso. O código está publicado para fins
de avaliação e consulta.
