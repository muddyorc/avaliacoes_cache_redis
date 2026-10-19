// A turma por dentro, na visão do professor (RF06, UC06).
//
// Mesma estrutura da turma do estudante — faixa de identificação, resumo à esquerda e a
// lista de provas à direita —, acrescida do que só o professor faz: compartilhar o código
// de acesso, decidir solicitações de entrada e ver quem está na turma.
//
// Clicar numa turma abre esta tela, não o formulário: editar é **uma** das ações daqui.
// Os dados vêm de `GET /api/turmas/:id`, a mesma rota que a tela de edição já usava.
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { CodigoTurma } from '../componentes/CodigoTurma.jsx';
import { EstadoVazio } from '../componentes/EstadoVazio.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { SeloStatus } from '../componentes/SeloStatus.jsx';
import { IconePessoa, IconeProva, IconeSeta } from '../componentes/Icones.jsx';
import { formatarDataHora, formatarPontos } from '../utils/datas.js';

const plural = (n, singular, plural_) => `${n} ${n === 1 ? singular : plural_}`;

export function TurmaProfessor() {
  const { id } = useParams();
  const local = useLocation();
  const navegar = useNavigate();

  const [turma, setTurma] = useState(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [ocupado, setOcupado] = useState(null);

  // Mensagem trazida pela navegação (ex.: "Turma criada"), lida uma vez e apagada do
  // histórico para não reaparecer ao recarregar.
  useEffect(() => {
    if (!local.state?.mensagem) return;
    setMensagem(local.state.mensagem);
    navegar(local.pathname, { replace: true, state: null });
  }, [local.state, local.pathname, navegar]);

  const carregar = useCallback(async () => {
    try {
      // A rota devolve { turma: ... } — o detalhe vem dentro da chave.
      setTurma((await api(`/turmas/${id}`)).turma);
    } catch (falha) {
      setErro(falha.message);
    }
  }, [id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Ações que devolvem a turma atualizada: uma só função, um só tratamento de erro.
  async function executar(chave, requisicao, textoSucesso, confirmar) {
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(chave);
    setErro('');
    setMensagem('');
    try {
      await requisicao();
      await carregar();
      setMensagem(textoSucesso);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(null);
    }
  }

  // Remover é exclusão lógica, e a confirmação diz isso: as provas já feitas continuam no
  // histórico da turma. Sem essa frase, "remover" parece apagar o que a pessoa fez — e o
  // professor hesitaria em usar uma ação que é legítima.
  const remover = (estudante) =>
    executar(
      `remover-${estudante.id}`,
      () => api(`/turmas/${id}/estudantes/${estudante.id}/remover`, { metodo: 'POST' }),
      `${estudante.nome} foi removido da turma.`,
      `Remover ${estudante.nome} da turma?

` +
        'Ele perde o acesso às avaliações, mas as provas que já fez continuam no histórico da turma. ' +
        'O estudante será avisado de que foi removido.',
    );

  // Duplicar virou rotina quando a prova passou a pertencer a UMA turma (15/10/2026):
  // aplicar a mesma avaliação noutra turma é duplicar. Ação frequente não pode exigir
  // abrir a prova e procurar no fim das configurações.
  //
  // A cópia nasce em rascunho e SEM turma — é o professor quem escolhe o novo público —,
  // então o destino é o editor dela, onde essa escolha é feita.
  const duplicar = (avaliacao) =>
    executar(
      `duplicar-${avaliacao.id}`,
      async () => {
        const r = await api(`/avaliacoes/${avaliacao.id}/duplicar`, { metodo: 'POST' });
        navegar(`/professor/avaliacoes/${r.avaliacao.id}`, {
          state: {
            mensagem: `Cópia criada em ${turma.nome}, em rascunho. Para aplicá-la a outra turma, troque a turma abaixo.`,
          },
        });
      },
      'Cópia criada.',
    );

  const decidir = (estudante, acao) =>
    executar(
      `${acao}-${estudante.id}`,
      () => api(`/turmas/${id}/solicitacoes/${estudante.id}/${acao}`, { metodo: 'POST' }),
      acao === 'aprovar' ? `${estudante.nome} agora participa da turma.` : `Solicitação de ${estudante.nome} recusada.`,
    );

  if (erro && !turma) {
    return (
      <Layout titulo="Turma">
        <div className="conteudo-central">
          <Aviso tipo="erro">{erro}</Aviso>
          <Link className="link-voltar" to="/professor/turmas">
            <IconeSeta />
            Voltar para as turmas
          </Link>
        </div>
      </Layout>
    );
  }

  if (!turma) {
    return (
      <Layout titulo="Turma">
        <div className="conteudo-central">
          <Carregando mensagem="Abrindo a turma…" />
        </div>
      </Layout>
    );
  }

  const ativa = turma.situacao === 'ATIVA';

  return (
    <Layout titulo={`Turma ${turma.nome}`}>
      <div className="conteudo-central">
        {/* Volta ao início, e não à lista de turmas: "Turmas" aqui convidava a abrir
            OUTRA turma, que não é o que alguém quer ao sair desta. E a lista já está no
            menu lateral, a um clique — este botão duplicava o caminho em vez de oferecer
            a saída que falta. */}
        <Link className="link-voltar" to="/professor">
          <IconeSeta />
          Início
        </Link>

        <header className="capa">
          <h1>{turma.nome}</h1>
          <span className="capa-apoio">
            {plural(turma.totalEstudantes, 'estudante', 'estudantes')} ·{' '}
            {turma.requerAprovacao ? 'entrada com aprovação' : 'entrada direta'}
            {!ativa && ' · turma inativa'}
          </span>
          {turma.descricao && <span className="capa-apoio">{turma.descricao}</span>}
        </header>

        <div className="barra-acoes">
          <Link className="botao" to={`/professor/turmas/${turma.id}/editar`}>
            Editar turma
          </Link>
          {/* Um botão, não dois: "Resultados" e "Desempenho" levavam a telas que
              respondiam a mesma pergunta com recortes diferentes (item 3 do feedback).
              `fixa=1` trava a turma no painel — quem entrou por aqui pediu ESTA turma. */}
          <Link
            className="botao botao-secundario"
            to={`/professor/dashboard?turma=${turma.id}&fixa=1`}
          >
            Desempenho desta turma
          </Link>
          {/* Criar já a partir da turma: a avaliação nasce vinculada a ela. Turma
              inativa não recebe avaliação nova, então a ação nem aparece. */}
          {ativa && (
            <Link className="botao botao-secundario" to={`/professor/avaliacoes/nova?turma=${turma.id}`}>
              Criar prova
            </Link>
          )}
        </div>

        <Aviso tipo="erro">{erro}</Aviso>
        <Aviso tipo="sucesso">{mensagem}</Aviso>

        {!ativa && (
          <div className="aviso aviso-alerta">
            Turma inativa: ninguém entra mais pelo código e ela não recebe novas avaliações. O
            histórico continua aqui — nada foi apagado.
          </div>
        )}

        <div className="colunas-resumo">
          <aside className="cartao">
            <h2 className="cartao-titulo">Compartilhar com a turma</h2>
            {ativa ? (
              <>
                <p className="texto-suave">
                  O estudante entra em <strong>Minhas turmas</strong> e digita este código.
                </p>
                <CodigoTurma codigo={turma.codigoAcesso} compacto />
                <button
                  className="botao botao-secundario botao-bloco"
                  type="button"
                  disabled={ocupado === 'codigo'}
                  onClick={() =>
                    executar(
                      'codigo',
                      () => api(`/turmas/${id}/codigo`, { metodo: 'POST' }),
                      'Novo código gerado. O anterior deixou de valer.',
                      'Gerar um novo código? O atual deixa de funcionar imediatamente. Quem já entrou continua na turma.',
                    )
                  }
                >
                  Gerar novo código
                </button>
              </>
            ) : (
              <p className="texto-suave sem-margem">
                Turma inativa: o código não aceita novas entradas. Reative a turma na edição para
                voltar a usá-lo.
              </p>
            )}
          </aside>

          <section>
            <div className="secao-topo">
              <div>
                <h2>Provas da turma</h2>
                <p>Todas as avaliações desta turma — rascunhos, publicadas e arquivadas.</p>
              </div>
              {/* A prova nasce aqui. Era preciso ir a uma listagem separada, criar e
                  depois vincular; agora a turma já é a dela desde o primeiro passo. */}
              <Link className="link-acao" to={`/professor/avaliacoes/nova?turma=${turma.id}`}>
                Nova avaliação
              </Link>
            </div>

            <div className="cartao">
              {turma.avaliacoes.length === 0 ? (
                <EstadoVazio Icone={IconeProva} titulo="Nenhuma avaliação ainda">
                  Crie a primeira prova desta turma. As questões vêm do seu{' '}
                  <Link to="/professor/questoes">banco de questões</Link> e podem ser reusadas em quantas provas
                  quiser.
                </EstadoVazio>
              ) : (
                <ul className="lista-simples sem-margem">
                  {turma.avaliacoes.map((a) => (
                    <li className="item-lista" key={a.id}>
                      <span className="item-lista-icone" aria-hidden="true">
                        <IconeProva />
                      </span>
                      <div className="item-lista-info">
                        <p className="item-lista-titulo">
                          {a.titulo} <SeloStatus status={a.status} />
                        </p>
                        <p className="item-lista-apoio">
                          {a.totalQuestoes} {a.totalQuestoes === 1 ? 'questão' : 'questões'} ·{' '}
                          {formatarPontos(a.pontuacaoTotal)} · {formatarDataHora(a.dataInicio)} até{' '}
                          {formatarDataHora(a.dataFim)}
                        </p>
                        {/* O estado da prova dito em palavras, e não só pelo selo: é o que
                            diz ao professor qual é o próximo passo dela. */}
                        {a.status === 'RASCUNHO' && a.totalQuestoes === 0 && (
                          <p className="item-lista-apoio texto-erro">Sem questões: ainda não pode ser publicada.</p>
                        )}
                        {a.totalTentativas > 0 && (
                          <p className="item-lista-apoio">
                            {a.totalTentativas} {a.totalTentativas === 1 ? 'prova feita' : 'provas feitas'}
                            {a.aguardandoCorrecao > 0
                              ? ` · ${a.aguardandoCorrecao} aguardando correção`
                              : a.resultadosLiberados
                                ? ' · resultados liberados'
                                : ' · tudo corrigido'}
                          </p>
                        )}
                      </div>
                      <div className="barra-acoes">
                        {/* Corrigir só aparece quando há o que corrigir — botão que abre
                            uma lista vazia é um convite frustrado. */}
                        {a.totalTentativas > 0 && (
                          <Link
                            className="botao botao-secundario botao-pequeno"
                            to={`/professor/avaliacoes/${a.id}?aba=correcao`}
                          >
                            Corrigir
                          </Link>
                        )}
                        <button
                          className="botao botao-secundario botao-pequeno"
                          type="button"
                          disabled={ocupado === `duplicar-${a.id}`}
                          onClick={() => duplicar(a)}
                        >
                          {ocupado === `duplicar-${a.id}` ? 'Duplicando…' : 'Duplicar'}
                        </button>
                        <Link className="botao botao-secundario botao-pequeno" to={`/professor/avaliacoes/${a.id}`}>
                          Abrir
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* ----------------------------------------------------- solicitações (UC06 A3/A4) */}
        {(turma.pendentes.length > 0 || turma.requerAprovacao) && (
          <section>
            <div className="secao-topo">
              <div>
                <h2>Solicitações pendentes</h2>
                <p>Entradas aguardando a sua decisão.</p>
              </div>
            </div>
            <div className="cartao">
              {turma.pendentes.length === 0 ? (
                <p className="texto-suave sem-margem">Nenhuma solicitação aguardando.</p>
              ) : (
                <ul className="lista-simples sem-margem">
                  {turma.pendentes.map((e) => (
                    <li className="item-lista" key={e.id}>
                      <span className="item-lista-icone" aria-hidden="true">
                        <IconePessoa />
                      </span>
                      <div className="item-lista-info">
                        <p className="item-lista-titulo">{e.nome}</p>
                        <p className="item-lista-apoio quebra">
                          {e.email} · pediu em {formatarDataHora(e.solicitadoEm)}
                        </p>
                      </div>
                      <div className="barra-acoes">
                        <button
                          className="botao botao-pequeno"
                          type="button"
                          disabled={ocupado !== null}
                          onClick={() => decidir(e, 'aprovar')}
                        >
                          Aprovar
                        </button>
                        <button
                          className="botao botao-secundario botao-pequeno"
                          type="button"
                          disabled={ocupado !== null}
                          onClick={() => decidir(e, 'recusar')}
                        >
                          Recusar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- estudantes */}
        <section>
          <div className="secao-topo">
            <div>
              <h2>Estudantes</h2>
              <p>{plural(turma.estudantes.length, 'estudante na turma', 'estudantes na turma')}.</p>
            </div>
          </div>
          <div className="cartao">
            {turma.estudantes.length === 0 ? (
              <EstadoVazio Icone={IconePessoa} titulo="Ninguém entrou ainda">
                Compartilhe o código de acesso com a turma.
              </EstadoVazio>
            ) : (
              <ul className="lista-simples sem-margem">
                {turma.estudantes.map((e) => (
                  <li className="item-lista" key={e.id}>
                    <span className="item-lista-icone" aria-hidden="true">
                      <IconePessoa />
                    </span>
                    <div className="item-lista-info">
                      <p className="item-lista-titulo">{e.nome}</p>
                      <p className="item-lista-apoio quebra">
                        {e.email}
                        {!e.contaAtiva && ' · conta inativa'}
                      </p>
                    </div>
                    <button
                      className="botao botao-secundario botao-pequeno"
                      type="button"
                      disabled={ocupado === `remover-${e.id}`}
                      onClick={() => remover(e)}
                    >
                      {ocupado === `remover-${e.id}` ? 'Removendo…' : 'Remover'}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Recusa feita por engano pode ser revertida — por isso a lista continua aqui. */}
            {turma.recusados.length > 0 && (
              <details className="espaco-acima-pequeno">
                <summary>Solicitações recusadas ({turma.recusados.length})</summary>
                <ul className="lista-simples sem-margem">
                  {turma.recusados.map((e) => (
                    <li className="item-lista" key={e.id}>
                      <div className="item-lista-info">
                        <p className="item-lista-titulo">{e.nome}</p>
                        <p className="item-lista-apoio quebra">{e.email}</p>
                      </div>
                      <button
                        className="botao botao-secundario botao-pequeno"
                        type="button"
                        disabled={ocupado !== null || !ativa}
                        title="Aprovar agora, corrigindo uma recusa feita por engano"
                        onClick={() => decidir(e, 'aprovar')}
                      >
                        Aprovar
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}
