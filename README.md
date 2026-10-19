# Avaliune — avaliações digitais, com cache em Redis

Aplicação web onde professores montam provas, aplicam a uma turma e corrigem; e estudantes
fazem a prova pelo navegador e veem a própria nota quando o professor libera.

Este repositório é a versão do sistema com uma **camada de cache em Redis** acrescentada por
cima do banco de dados, para reduzir o trabalho do PostgreSQL durante a prova.

---

## O que o sistema faz

São três perfis:

- **Administrador** — cadastra professores.
- **Professor** — monta um banco de questões (objetivas e discursivas), junta questões numa
  prova, aplica a prova a uma turma, acompanha quem está fazendo, corrige e libera as notas.
  Na correção das discursivas pode pedir uma sugestão de nota a uma IA, que é só sugestão: quem
  dá a nota é sempre o professor.
- **Estudante** — entra na turma por um código, faz a prova em tela cheia, com salvamento
  automático, e vê a nota depois que o professor libera.

Enquanto a prova acontece, o navegador avisa o servidor quando a janela perde o foco, quando o
estudante troca de aba ou sai da tela cheia. O sistema **registra** esses acontecimentos — ele não
acusa ninguém de nada, e quem conta e decide é sempre o servidor, nunca a tela.

Feito com React no navegador, Express no servidor e PostgreSQL no banco, com SQL escrito à mão.
Tudo em português: variáveis, funções, tabelas, rotas e comentários.

---

## Como rodar

Você precisa de **Node.js 22 ou mais novo** e **PostgreSQL**.

**1. Configure.** Copie o arquivo de exemplo e preencha:

```bash
cp .env.example .env
```

O mínimo a preencher são três linhas:

```bash
DATABASE_URL=postgresql://usuario:senha@localhost:5432/avaliacoes
DATABASE_URL_TESTE=postgresql://usuario:senha@localhost:5432/avaliacoes_teste
JWT_SECRET=um_valor_longo_e_aleatorio
```

Para gerar o `JWT_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

**2. Instale e prepare o banco:**

```bash
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run setup     # cria as tabelas e o administrador inicial
```

**3. Suba, em dois terminais:**

```bash
npm run dev:api      # API em http://localhost:3000
npm run dev:site     # site em http://localhost:5173
```

Abra http://localhost:5173 e entre com o e-mail e a senha de administrador que você pôs no
`.env`. Por ele você cadastra um professor; o estudante cria a própria conta pelo link
**Criar conta**.

---

## O cache em Redis

### O problema

Quando o estudante está fazendo a prova, a tela salva as respostas sozinha a cada 10 segundos. A
cada salvamento, e a cada vez que a página é retomada, o servidor executa a mesma função —
`questoesDaProva` — que faz **3 consultas** ao PostgreSQL para montar a estrutura da prova:
enunciados, alternativas e pontuações.

Numa turma de 40 estudantes fazendo uma prova de uma hora, isso dá cerca de **14.400 execuções** e
**43.200 consultas**, todas pedindo exatamente a mesma coisa.

### O que guardamos

Uma chave por prova, com a estrutura inteira em JSON:

```
prova:v1:42:estrutura     →   [ { questaoId: 7, enunciado: "...", alternativas: [...] }, ... ]
```

O `v1` é a versão do formato: se um dia o JSON mudar de desenho, é só passar para `v2` e as chaves
velhas somem sozinhas, sem precisar limpar o Redis na mão.

O prazo de validade é de **6 horas**.

### Como funciona

É o padrão **cache-aside**, que em código fica assim:

```js
// procura no cache primeiro
const guardado = await buscar(chave);
if (guardado) return guardado;              // HIT — nenhuma consulta ao banco

// não achou: vai na fonte da verdade
const estrutura = await (3 consultas ao PostgreSQL);   // MISS

// e guarda para a próxima
await guardar(chave, estrutura, 6 * 60 * 60);
return estrutura;
```

### Por que não existe invalidação

Normalmente, a parte difícil de um cache é lembrar de apagar a cópia quando o dado muda. **Aqui
não existe esse problema**, e por um motivo concreto do sistema:

Quando o **primeiro** estudante inicia a prova, ela **congela** — guarda a própria cópia das
questões. Dali em diante, o professor não consegue mais alterar nada: há duas travas no código
que recusam a edição assim que existe uma tentativa. Ou seja, **a estrutura de uma prova em
andamento nunca muda**. Não há o que invalidar.

Por isso só guardamos no cache a prova **já congelada**. Antes do congelamento a prova ainda
acompanha o banco de questões e o professor pode mexer nela à vontade — e aí guardar seria
arrumar encrenca.

### Se o Redis cair

O sistema continua funcionando normalmente, lendo tudo do PostgreSQL. O cache é um atalho, não
uma dependência: nenhuma função dele lança erro para quem chamou, e qualquer problema — servidor
fora do ar, demora, valor estragado — vira simplesmente "não achei". Aparece um aviso no log, uma
vez só, e a vida segue.

Depois de uma falha ele para de tentar por 30 segundos. Sem essa pausa, com o Redis fora do ar
toda requisição ficaria esperando a conexão dar erro, e o atalho viraria pedágio.

### Para ligar

O Redis é opcional. Para subir:

```bash
docker run -d --name redis -p 6379:6379 redis:7
docker exec -it redis redis-cli PING      # responde PONG
```

E no `.env`:

```bash
CACHE_ATIVO=true
REDIS_URL=redis://localhost:6379
```

### Quanto melhorou

Medimos a mesma operação 1.000 vezes seguidas, com o mesmo comando e o mesmo cenário (uma prova de
40 questões), mudando só o `CACHE_ATIVO`:

```bash
cd backend
NODE_ENV=test CACHE_ATIVO=false npm run medir     # antes
NODE_ENV=test CACHE_ATIVO=true  npm run medir     # depois
```

> No PowerShell, as variáveis vão antes, em linhas separadas:
> `$env:NODE_ENV="test"; $env:CACHE_ATIVO="true"; npm run medir`

| | tempo por operação | operações por segundo |
|---|---|---|
| Sem cache (PostgreSQL) | 2,58 ms | 388 |
| Com cache (Redis) | **1,08 ms** | **935** |
| | **2,4× mais rápido** | |

**Uma ressalva honesta sobre esse número.** Dos 1,08 ms da versão com cache, **0,71 ms é só ida e
volta na rede** — é o que custa um simples `PING` ao Redis nesta máquina, porque o Docker Desktop
no Windows leva cada pacote por dentro de uma máquina virtual. Em Linux o mesmo `PING` custa perto
de 0,03 ms. Então **2,4× é o piso deste ambiente, não o limite da solução**: com a aplicação e o
Redis no mesmo servidor Linux, o ganho seria bem maior. Não medimos isso porque não temos Linux
aqui, e preferimos dizer o que dá para provar.

As medições completas, com a saída literal dos comandos, estão em
[`docs/evidencias/`](docs/evidencias/).

---

## Testes

```bash
npm test             # backend (485) + frontend (30)
npm run lint         # análise estática nos dois
```

Os testes nunca tocam o banco de desenvolvimento: eles usam um banco separado, apagam os dados
dele a cada execução e se recusam a rodar se a configuração estiver errada.

O cache entra **desligado** nos testes, de propósito — uma suíte não pode depender de um servidor
externo estar no ar, nem mudar de resultado conforme a máquina. Os 8 testes da camada ligam o que
precisam no próprio código, e os que exigem um Redis de verdade se marcam como pulados quando não
há nenhum. Para rodar tudo contra um Redis real:

```bash
CACHE_NOS_TESTES=true npm test
```

---

## Onde fica cada coisa

```
backend/
  migrations/            o esquema do banco, um arquivo por mudança
  scripts/               medir.js (mede uma operação), estresse.js (simula uma turma)
  src/servicos/cache.js  a camada de cache
  src/modules/           um diretório por assunto: rotas + regras de negócio
  tests/
frontend/
  src/paginas/           uma por tela
docs/evidencias/         as medições, com a saída literal dos comandos
```

---

## Equipe

Julio Cezar Rodrigues Correia · Eduardo Machado Martins · Thiago Santana de Andrade

ESW441 — Prof. Gustavo Martins Lima
