// UC05 — banco de questões do professor (RF05).
//
// "Excluir" é inativar (Quadro 31): a questão sai do banco ativo mas continua preservada.
// Os botões chegam desabilitados, com o motivo, quando a regra impede a ação — e o
// backend recusa de novo se alguém tentar pela API.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Layout } from '../componentes/Layout.jsx';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { FormularioQuestao } from '../componentes/FormularioQuestao.jsx';

const LETRAS = 'ABCDEFGHIJ';

const TAMANHO_PAGINA = 10;
const ROTULO_TIPO = { OBJETIVA: 'Objetiva', DISCURSIVA: 'Discursiva' };

function formatarPontos(valor) {
  const texto = Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return `${texto} ${Number(valor) === 1 ? 'ponto' : 'pontos'}`;
}

// Explica em linguagem simples o estado da questão: o que impede uma ação e o que é só
// informação. Editar é sempre permitido (P-22) — a prova já aplicada tem a própria cópia.
function motivoBloqueio(uso) {
  if (uso.emAvaliacaoPublicada) {
    return 'Está em uma avaliação publicada que ainda não foi aplicada: pode ser editada, mas não excluída.';
  }
  if (uso.respondida) {
    return 'Já usada em provas aplicadas. Editar aqui não altera aquelas provas: elas guardam a própria cópia.';
  }
  return null;
}

export function Questoes() {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroTema, setFiltroTema] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState('ATIVA');
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState(null);
  const [temas, setTemas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [editando, setEditando] = useState(null); // null | 'nova' | questão com alternativas
  // Alternativas abertas sob demanda, uma questão por vez. A listagem traz só o
  // enunciado, e conferir o gabarito exigia abrir a edição — caminho longo demais para
  // uma pergunta que é só "qual era a resposta certa mesmo?".
  const [alternativas, setAlternativas] = useState({});
  const [ocupado, setOcupado] = useState(null);

  const carregarTemas = useCallback(async () => {
    try {
      setTemas((await api('/questoes/temas')).temas);
    } catch {
      // Sem temas o filtro só fica vazio; a lista principal mostra o erro, se houver.
    }
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const parametros = new URLSearchParams({
        pagina: String(pagina),
        tamanho: String(TAMANHO_PAGINA),
        situacao: filtroSituacao,
      });
      if (buscaAplicada) parametros.set('busca', buscaAplicada);
      if (filtroTipo) parametros.set('tipo', filtroTipo);
      if (filtroTema) parametros.set('tema', filtroTema);
      setDados(await api(`/questoes?${parametros}`));
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setCarregando(false);
    }
  }, [buscaAplicada, filtroTipo, filtroTema, filtroSituacao, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    carregarTemas();
  }, [carregarTemas]);

  function aplicarFiltro(acao) {
    setPagina(1);
    acao();
  }

  async function alternarAlternativas(questaoId) {
    if (alternativas[questaoId]) {
      setAlternativas((atual) => {
        const copia = { ...atual };
        delete copia[questaoId];
        return copia;
      });
      return;
    }
    setAlternativas((atual) => ({ ...atual, [questaoId]: { carregando: true } }));
    try {
      const { questao } = await api(`/questoes/${questaoId}`);
      setAlternativas((atual) => ({ ...atual, [questaoId]: { lista: questao.alternativas ?? [] } }));
    } catch (falha) {
      setAlternativas((atual) => ({ ...atual, [questaoId]: { erro: falha.message } }));
    }
  }

  // A lista não traz as alternativas: o detalhe é buscado ao abrir a edição.
  async function abrirEdicao(id) {
    setOcupado(id);
    setErro('');
    try {
      setEditando((await api(`/questoes/${id}`)).questao);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(null);
    }
  }

  async function executar(id, acao, textoSucesso) {
    setOcupado(id);
    setErro('');
    setMensagem('');
    try {
      await acao();
      setMensagem(textoSucesso);
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(null);
    }
  }

  async function aoSalvar(valores) {
    if (editando === 'nova') {
      await api('/questoes', { metodo: 'POST', corpo: valores });
      setMensagem('Questão cadastrada.');
    } else {
      await api(`/questoes/${editando.id}`, { metodo: 'PUT', corpo: valores });
      setMensagem('Questão atualizada.');
    }
    setEditando(null);
    await Promise.all([carregar(), carregarTemas()]);
  }

  if (editando) {
    return (
      <FormularioQuestao
        questao={editando === 'nova' ? null : editando}
        temas={temas}
        aoSalvar={aoSalvar}
        aoCancelar={() => setEditando(null)}
      />
    );
  }

  return (
    // Dentro do Layout: esta tela está no menu lateral, e abri-la fazia o menu sumir —
    // o próprio caminho que trouxe o professor até aqui desaparecia.
    <Layout titulo="Banco de questões">
      <div className="conteudo-central">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>Banco de questões</h1>
          <p>Cadastre, organize e reutilize suas questões. Questões nunca são apagadas, apenas inativadas.</p>
        </div>
        <Link className="botao botao-secundario" to="/professor">
          Voltar
        </Link>
      </header>

      <section className="painel">
        <div className="barra-acoes">
          <button className="botao" type="button" onClick={() => setEditando('nova')}>
            Nova questão
          </button>
        </div>

        <form
          className="filtros"
          onSubmit={(e) => {
            e.preventDefault();
            setPagina(1);
            setBuscaAplicada(busca.trim());
          }}
        >
          <Campo
            id="busca"
            rotulo="Buscar no enunciado"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          <div className="campo">
            <label htmlFor="filtroTipo">Tipo</label>
            <select id="filtroTipo" value={filtroTipo} onChange={(e) => aplicarFiltro(() => setFiltroTipo(e.target.value))}>
              <option value="">Todos</option>
              <option value="OBJETIVA">Objetivas</option>
              <option value="DISCURSIVA">Discursivas</option>
            </select>
          </div>

          <div className="campo">
            <label htmlFor="filtroTema">Tema</label>
            <select id="filtroTema" value={filtroTema} onChange={(e) => aplicarFiltro(() => setFiltroTema(e.target.value))}>
              <option value="">Todos</option>
              {temas.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label htmlFor="filtroSituacao">Situação</label>
            <select
              id="filtroSituacao"
              value={filtroSituacao}
              onChange={(e) => aplicarFiltro(() => setFiltroSituacao(e.target.value))}
            >
              <option value="ATIVA">Ativas</option>
              <option value="INATIVA">Inativas</option>
              <option value="TODAS">Todas</option>
            </select>
          </div>

          <button className="botao botao-secundario" type="submit">
            Filtrar
          </button>
        </form>

        <Aviso tipo="erro">{erro}</Aviso>
        <Aviso tipo="sucesso">{mensagem}</Aviso>

        {carregando && <Carregando />}

        {dados && !carregando && (
          <>
            {dados.questoes.length === 0 ? (
              <p className="texto-suave">
                {dados.total === 0 && !buscaAplicada && !filtroTipo && !filtroTema && filtroSituacao === 'ATIVA'
                  ? 'Você ainda não cadastrou questões. Comece por "Nova questão".'
                  : 'Nenhuma questão encontrada com estes filtros.'}
              </p>
            ) : (
              <ul className="lista-questoes">
                {dados.questoes.map((q) => {
                  const motivo = motivoBloqueio(q.uso);
                  return (
                    <li key={q.id} className={`cartao-questao${q.situacao === 'INATIVA' ? ' cartao-inativo' : ''}`}>
                      <div className="cartao-meta">
                        <span className="selo">{ROTULO_TIPO[q.tipo]}</span>
                        {q.tema && <span className="selo selo-neutro">{q.tema}</span>}
                        <span className="texto-suave">{formatarPontos(q.pontuacaoPadrao)}</span>
                        {/* A contagem de alternativas saiu daqui: o botão "Ver
                            alternativas", logo abaixo, mostra as próprias — e o número
                            ao lado dele dizia a mesma coisa com menos utilidade. */}
                        {q.situacao === 'INATIVA' && <span className="situacao-inativa">Inativa</span>}
                      </div>

                      <p className="cartao-enunciado">{q.enunciado}</p>

                      {q.tipo === 'OBJETIVA' && (
                        <div className="espaco-acima-pequeno">
                          <button
                            className="botao botao-secundario botao-pequeno"
                            type="button"
                            aria-expanded={Boolean(alternativas[q.id])}
                            onClick={() => alternarAlternativas(q.id)}
                          >
                            {alternativas[q.id] ? 'Ocultar alternativas' : 'Ver alternativas'}
                          </button>
                          {alternativas[q.id]?.carregando && <p className="texto-suave">Carregando…</p>}
                          {alternativas[q.id]?.erro && <p className="campo-erro">{alternativas[q.id].erro}</p>}
                          {alternativas[q.id]?.lista && (
                            <ul className="alternativas-editor espaco-acima-pequeno">
                              {alternativas[q.id].lista.map((alt, indice) => (
                                <li key={alt.id} className={alt.correta ? 'correta' : ''}>
                                  <span className="alternativa-letra" aria-hidden="true">
                                    {LETRAS[indice] ?? indice + 1}
                                  </span>
                                  <span className="quebra">
                                    {alt.texto}
                                    {alt.correta && <strong> · correta</strong>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      {/* Uma linha sobre o uso, e não três. "Usada em 5 avaliações" e a
                          explicação longa falavam do mesmo assunto, empilhadas.
                          A explicação é uma RESSALVA sobre editar, não um estado da
                          questão: ela vive na dica do botão Editar, que é onde ela
                          importa, e aqui fica só o fato. */}
                      {q.uso.avaliacoesVinculadas > 0 && (
                        <p className="texto-suave cartao-uso">
                          Usada em {q.uso.avaliacoesVinculadas}{' '}
                          {q.uso.avaliacoesVinculadas === 1 ? 'avaliação' : 'avaliações'}
                          {q.uso.respondida && ' · já aplicada'}
                        </p>
                      )}

                      <div className="acoes">
                        <button
                          className="botao botao-secundario botao-pequeno"
                          type="button"
                          disabled={!q.uso.podeEditar || ocupado === q.id}
                          title={motivo ?? undefined}
                          onClick={() => abrirEdicao(q.id)}
                        >
                          Editar
                        </button>
                        <button
                          className="botao botao-secundario botao-pequeno"
                          type="button"
                          disabled={ocupado === q.id}
                          onClick={() =>
                            executar(
                              q.id,
                              () => api(`/questoes/${q.id}/duplicar`, { metodo: 'POST' }),
                              'Cópia criada. Ela é independente e pode ser editada.',
                            )
                          }
                        >
                          Duplicar
                        </button>
                        {q.situacao === 'ATIVA' ? (
                          <button
                            className="botao botao-secundario botao-pequeno"
                            type="button"
                            disabled={!q.uso.podeInativar || ocupado === q.id}
                            title={!q.uso.podeInativar ? motivo : undefined}
                            onClick={() =>
                              executar(
                                q.id,
                                () => api(`/questoes/${q.id}/situacao`, { metodo: 'PATCH', corpo: { situacao: 'INATIVA' } }),
                                'Questão inativada. Ela continua preservada e pode ser reativada.',
                              )
                            }
                          >
                            Inativar
                          </button>
                        ) : (
                          <button
                            className="botao botao-secundario botao-pequeno"
                            type="button"
                            disabled={ocupado === q.id}
                            onClick={() =>
                              executar(
                                q.id,
                                () => api(`/questoes/${q.id}/situacao`, { metodo: 'PATCH', corpo: { situacao: 'ATIVA' } }),
                                'Questão reativada.',
                              )
                            }
                          >
                            Reativar
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="paginacao">
              <button
                className="botao botao-secundario botao-pequeno"
                type="button"
                disabled={pagina <= 1}
                onClick={() => setPagina((p) => p - 1)}
              >
                Anterior
              </button>
              <span className="texto-suave">
                Página {dados.pagina} de {dados.paginas} · {dados.total} questão(ões)
              </span>
              <button
                className="botao botao-secundario botao-pequeno"
                type="button"
                disabled={pagina >= dados.paginas}
                onClick={() => setPagina((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          </>
        )}
        </section>
      </div>
    </Layout>
  );
}
