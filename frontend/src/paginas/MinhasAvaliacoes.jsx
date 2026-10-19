// UC08, passos 2 e 3 — as avaliações que o estudante pode realizar, com a situação de
// cada uma. Cobre A1 (ainda não disponível, com a data) e A2 (período encerrado).
//
// Esta é a tela de pendências do estudante (decisão do autor em 18/10/2026). Em vez de
// uma aba nova só para "o que tenho para fazer" — que seria a quarta lista das mesmas
// provas, somando-se ao Início, a esta tela e à tela da turma —, é esta que ganhou o que
// faltava para responder à pergunta: filtro por situação, filtro por turma e, sobretudo,
// agrupamento por prazo. Numa lista corrida ordenada por data, saber o que é urgente
// exigia ler data por data.
//
// Uma diferença em relação ao Google Classroom, que inspirou o formato: aqui toda prova
// tem prazo obrigatório, então não existe grupo "sem data de entrega".
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { EstadoVazio } from '../componentes/EstadoVazio.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { IconeProva, IconeSeta } from '../componentes/Icones.jsx';
import { formatarDataHora, formatarDuracao, formatarPontos, prazoDoEstudante } from '../utils/datas.js';
import { pedirTelaCheia } from '../utils/telaCheia.js';

const SITUACAO = {
  DISPONIVEL: { rotulo: 'Disponível', classe: 'selo-status-publicada' },
  EM_ANDAMENTO: { rotulo: 'Em andamento', classe: 'selo-alerta' },
  AGENDADA: { rotulo: 'Ainda não disponível', classe: 'selo-neutro' },
  ENCERRADA: { rotulo: 'Período encerrado', classe: 'selo-status-arquivada' },
  FINALIZADA: { rotulo: 'Entregue', classe: 'selo-status-arquivada' },
  TEMPO_ESGOTADO: { rotulo: 'Encerrada por tempo', classe: 'selo-status-arquivada' },
  BLOQUEADA: { rotulo: 'Encerrada pelo monitoramento', classe: 'selo-status-arquivada' },
  // Prazo vencido sem ter sido aberta: o sistema registra a prova em branco (migração
  // 014). "Não realizada" e não "entregue": ninguém entregou nada.
  NAO_REALIZADA: { rotulo: 'Não realizada', classe: 'selo-status-arquivada' },
};

// O que ainda depende do estudante. Entregue, encerrada e não realizada saem daqui: não
// há nada a fazer a respeito delas além de consultar.
const PENDENTES = ['EM_ANDAMENTO', 'DISPONIVEL', 'AGENDADA'];
const ehPendente = (a) => PENDENTES.includes(a.situacao);

const FILTROS = [
  { chave: 'pendentes', rotulo: 'A fazer' },
  { chave: 'concluidas', rotulo: 'Concluídas' },
  { chave: 'todas', rotulo: 'Todas' },
];

// Fim do domingo da semana de `data`, que é onde "esta semana" termina. Semana de
// calendário, e não "sete dias a partir de hoje": é assim que o estudante organiza a
// própria — uma prova de sexta é "esta semana" na segunda e continua sendo na quinta.
function fimDaSemana(data) {
  const fim = new Date(data);
  fim.setDate(fim.getDate() + (7 - fim.getDay()) % 7);
  fim.setHours(23, 59, 59, 999);
  return fim;
}

const GRUPOS = [
  { chave: 'encerradas', rotulo: 'Prazo encerrado' },
  { chave: 'semana', rotulo: 'Esta semana' },
  { chave: 'proxima', rotulo: 'Próxima semana' },
  { chave: 'depois', rotulo: 'Depois' },
];

function grupoDe(avaliacao, agora) {
  // Agrupa pelo prazo DELE: a prova devolvida com trinta minutos pertence a "esta
  // semana", não a "depois", por mais longe que esteja o fim do período.
  const prazo = new Date(prazoDoEstudante(avaliacao));
  if (prazo <= agora) return 'encerradas';
  const estaSemana = fimDaSemana(agora);
  if (prazo <= estaSemana) return 'semana';
  const proximaSemana = new Date(estaSemana);
  proximaSemana.setDate(proximaSemana.getDate() + 7);
  return prazo <= proximaSemana ? 'proxima' : 'depois';
}

export function MinhasAvaliacoes() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('pendentes');
  const [turma, setTurma] = useState('');

  const carregar = useCallback(async () => {
    try {
      setDados(await api('/estudante/avaliacoes'));
    } catch (falha) {
      setErro(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // A memória é sobre `dados`, e não sobre uma lista derivada: `?? []` cria um array
  // novo a cada render, e aí a memória nunca valeria de nada.
  const avaliacoes = useMemo(() => dados?.avaliacoes ?? [], [dados]);

  // As turmas que aparecem no seletor saem das próprias provas: listar turma sem prova
  // nenhuma só daria ao estudante um filtro que não filtra nada.
  const turmas = useMemo(() => {
    const porId = new Map();
    for (const a of avaliacoes) if (a.turma) porId.set(a.turma.id, a.turma.nome);
    return [...porId].map(([id, nome]) => ({ id, nome })).sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  }, [avaliacoes]);

  const agora = new Date();
  const visiveis = avaliacoes.filter((a) => {
    if (turma && String(a.turma?.id) !== turma) return false;
    if (filtro === 'pendentes') return ehPendente(a);
    if (filtro === 'concluidas') return !ehPendente(a);
    return true;
  });

  // Grupos vazios não aparecem: um cabeçalho com zero embaixo ocupa a tela para dizer
  // que não há nada ali.
  const grupos = GRUPOS.map((g) => ({
    ...g,
    itens: visiveis.filter((a) => grupoDe(a, agora) === g.chave),
  })).filter((g) => g.itens.length > 0);

  return (
    // Dentro do Layout: esta tela está no menu lateral, e abri-la fazia o menu sumir —
    // o próprio caminho que trouxe o estudante até aqui desaparecia.
    <Layout>
      <div className="conteudo-central">
        <header className="cabecalho cabecalho-barra">
          <div>
            <h1>Avaliações</h1>
            {/* "e provas abertas a todos" saiu com a visibilidade pública (migração 010):
                toda prova é de uma turma, e o texto prometia o que não existe mais. */}
            <p>Provas das turmas em que você participa.</p>
          </div>
          {/* O menu lateral já leva ao início; este botão nomeia o destino em vez de dizer
              só "Voltar", que não diz para onde. */}
          <Link className="botao botao-secundario" to="/estudante">
            Ir para o início
          </Link>
        </header>

        <Aviso tipo="erro">{erro}</Aviso>
        {!dados && !erro && <Carregando />}

        {dados && avaliacoes.length === 0 && (
          <section className="painel">
            <p className="texto-suave sem-margem">
              Nenhuma avaliação para você no momento. Se o professor passou um código de turma, entre em{' '}
              <Link to="/estudante/turmas">Minhas turmas</Link>.
            </p>
          </section>
        )}

        {dados && avaliacoes.length > 0 && (
          <>
            <div className="barra-filtros">
              <div className="filtros-chip" role="group" aria-label="Filtrar provas">
                {FILTROS.map(({ chave, rotulo }) => (
                  <button
                    key={chave}
                    type="button"
                    className={`chip ${filtro === chave ? 'chip-ativo' : ''}`}
                    aria-pressed={filtro === chave}
                    onClick={() => setFiltro(chave)}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              {/* Só com mais de uma turma: com uma só, o seletor não teria o que escolher. */}
              {turmas.length > 1 && (
                <div className="campo sem-margem">
                  <label className="apenas-leitor" htmlFor="filtroTurma">
                    Turma
                  </label>
                  <select id="filtroTurma" value={turma} onChange={(e) => setTurma(e.target.value)}>
                    <option value="">Todas as turmas</option>
                    {turmas.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {grupos.length === 0 ? (
              <section className="painel">
                <EstadoVazio
                  Icone={IconeProva}
                  titulo={filtro === 'pendentes' ? 'Nada pendente por aqui' : 'Nenhuma prova concluída ainda'}
                >
                  {turma
                    ? 'Nenhuma prova desta turma nesta situação. Experimente outro filtro.'
                    : 'Use os filtros acima para ver as outras provas.'}
                </EstadoVazio>
              </section>
            ) : (
              grupos.map((grupo) => (
                /* `<details>` nativo, e não um estado em React: o navegador já dá o
                   teclado, o leitor de tela e o "aria-expanded" de graça, e o sistema já
                   usa isto nas solicitações recusadas da turma.
                   Aberto por padrão, MENOS o prazo encerrado — é histórico, e é
                   justamente ele que enche a tela de quem só quer ver o que falta. */
                <details className="painel grupo-prazo" key={grupo.chave} open={grupo.chave !== 'encerradas'}>
                  <summary className="grupo-prazo-topo">
                    <h2 className="cartao-titulo sem-margem">{grupo.rotulo}</h2>
                    <span className="texto-suave">
                      {grupo.itens.length} {grupo.itens.length === 1 ? 'prova' : 'provas'}
                    </span>
                    <IconeSeta className="icone grupo-prazo-seta" />
                  </summary>

                  <ul className="lista-questoes espaco-acima-pequeno">
                    {grupo.itens.map((a) => (
                      <CartaoDaProva key={a.id} avaliacao={a} />
                    ))}
                  </ul>
                </details>
              ))
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function CartaoDaProva({ avaliacao: a }) {
  const s = SITUACAO[a.situacao] ?? { rotulo: a.situacao, classe: 'selo-neutro' };

  return (
    <li className="cartao-questao">
      <div className="cartao-meta">
        <span className={`selo ${s.classe}`}>{s.rotulo}</span>
        <span className="texto-suave">
          {a.totalQuestoes} {a.totalQuestoes === 1 ? 'questão' : 'questões'} · {formatarPontos(a.pontuacaoTotal)} ·{' '}
          {formatarDuracao(a.duracaoMinutos)}
        </span>
      </div>

      <p className="cartao-titulo">{a.titulo}</p>
      {/* A turma primeiro, o professor depois: numa lista que mistura turmas, é a turma
          que situa a prova. Dentro da turma essa linha não existe — lá é redundante. */}
      <p className="texto-suave cartao-uso">
        {a.turma ? `${a.turma.nome} · ` : ''}
        {a.professor}
      </p>

      {a.situacao === 'AGENDADA' ? (
        // UC08 A1: informa quando ficará disponível.
        <p className="cartao-aviso">Disponível a partir de {formatarDataHora(a.dataInicio)}.</p>
      ) : a.situacao === 'ENCERRADA' ? (
        // UC08 A2.
        <p className="cartao-aviso">O período terminou em {formatarDataHora(a.dataFim)}.</p>
      ) : (
        <p className="texto-suave cartao-uso">
          Disponível até {formatarDataHora(a.dataFim)}
          {a.situacao === 'EM_ANDAMENTO' && a.tentativa
            ? ` · seu tempo termina em ${formatarDataHora(a.tentativa.prazoFinal)}`
            : ''}
        </p>
      )}

      {['FINALIZADA', 'TEMPO_ESGOTADO'].includes(a.situacao) && (
        <>
          <p className="texto-suave cartao-uso">
            {a.situacao === 'TEMPO_ESGOTADO' ? 'Encerrada por tempo' : 'Entregue'} em{' '}
            {formatarDataHora(a.tentativa.finalizadaEm)}.
          </p>
          {/* P-07: a nota só aparece depois que o professor libera os resultados e a
              correção daquela prova está concluída. */}
          {a.resultado ? (
            <p className="nota-liberada">
              Nota: <strong>{formatarPontos(a.resultado.nota)}</strong> de {formatarPontos(a.resultado.pontuacaoMaxima)}
            </p>
          ) : (
            <p className="texto-suave cartao-uso">Nota ainda não liberada: aguarde a correção do professor.</p>
          )}
        </>
      )}

      {/* Sempre há para onde ir: antes, só a prova que dá para começar tinha botão, e a
          entregue ou não realizada ficava sem caminho — o estudante lia a linha e não
          tinha como abrir nada. O rótulo diz o que vai acontecer; o destino é o mesmo
          endereço, que se encarrega de mostrar instruções, prova ou resultado conforme a
          situação. SEM parâmetro de origem, de propósito: quem clicou aqui veio DESTA
          tela, e o destino padrão do Voltar da prova é justamente ela. Quem entra pela
          turma leva turma=, quem entra pelo início leva de=inicio. */}
      <div className="acoes">
        <Link
          className={`botao botao-pequeno${a.podeIniciar || a.podeContinuar ? '' : ' botao-secundario'}`}
          to={`/estudante/avaliacoes/${a.id}`}
          // Continuar uma prova aberta volta direto para a tela cheia: é o clique que
          // dá ao navegador o gesto de que ele precisa.
          onClick={() => a.podeContinuar && pedirTelaCheia()}
        >
          {a.podeContinuar
            ? 'Continuar prova'
            : a.podeIniciar
              ? 'Iniciar prova'
              : a.resultado
                ? 'Ver resultado'
                : 'Ver prova'}
        </Link>
      </div>
    </li>
  );
}
