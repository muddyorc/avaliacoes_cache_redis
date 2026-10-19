// A turma por dentro, na visão do estudante (RF06/RF07 + UC08).
//
// Referência visual: a página de uma turma no Google Classroom — faixa de identificação,
// um resumo curto à esquerda e a lista do que há para fazer à direita. O conteúdo é o
// nosso: em vez de mural e materiais, as **provas vinculadas àquela turma**, separadas
// entre o que ainda pede ação e o que já terminou.
//
// Tudo vem de `GET /api/estudante/turmas/:id`. A tela não decide o que o estudante pode
// ver: quem filtra provas, esconde gabarito e segura a nota até a liberação é o servidor.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { EstadoVazio } from '../componentes/EstadoVazio.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { CancelarInscricao } from '../componentes/CancelarInscricao.jsx';
import { pedirTelaCheia } from '../utils/telaCheia.js';
import { IconePessoa, IconeProva, IconeRelogio, IconeSeta } from '../componentes/Icones.jsx';
import {
  formatarDataHora,
  formatarDuracao,
  formatarPontos,
  prazoDoEstudante,
  urgenciaDoPrazo,
} from '../utils/datas.js';

// Como cada situação devolvida pelo servidor aparece para o estudante.
// `pendente` é o que separa "ainda pede alguma coisa de você" de "já terminou".
const SITUACAO = {
  EM_ANDAMENTO: { rotulo: 'Em andamento', etiqueta: 'etiqueta-alerta', acao: 'Continuar', pendente: true },
  DISPONIVEL: { rotulo: 'Disponível', etiqueta: 'etiqueta', acao: 'Fazer prova', pendente: true },
  AGENDADA: { rotulo: 'Ainda não abriu', etiqueta: 'etiqueta-neutra', acao: 'Ver detalhes', pendente: true },
  FINALIZADA: { rotulo: 'Entregue', etiqueta: 'etiqueta-sucesso', acao: 'Ver', pendente: false },
  TEMPO_ESGOTADO: { rotulo: 'Encerrada por tempo', etiqueta: 'etiqueta-alerta', acao: 'Ver', pendente: false },
  BLOQUEADA: { rotulo: 'Encerrada pelo monitoramento', etiqueta: 'etiqueta-alerta', acao: 'Ver', pendente: false },
  // Período encerrado sem tentativa: a prova passou sem ser feita.
  ENCERRADA: { rotulo: 'Não entregue', etiqueta: 'etiqueta-alerta', acao: 'Ver', pendente: false },
  // O mesmo caso, depois de o sistema registrar a prova em branco (migração 014). Os
  // dois textos convivem: 'ENCERRADA' é o que a tela mostra até alguém abrir a prova,
  // a correção ou o dashboard e disparar o registro.
  NAO_REALIZADA: { rotulo: 'Não realizada', etiqueta: 'etiqueta-alerta', acao: 'Ver gabarito', pendente: false },
};

const FILTROS = [
  { chave: 'pendentes', rotulo: 'A fazer' },
  { chave: 'concluidas', rotulo: 'Concluídas' },
  { chave: 'todas', rotulo: 'Todas' },
];

const descricaoDaSituacao = (avaliacao) => SITUACAO[avaliacao.situacao] ?? { rotulo: avaliacao.situacao, etiqueta: 'etiqueta-neutra', acao: 'Ver', pendente: true };

function LinhaDaProva({ avaliacao, turmaId }) {
  const { rotulo, etiqueta, acao, pendente } = descricaoDaSituacao(avaliacao);
  const { resultado } = avaliacao;
  // Urgência só no que ainda depende do estudante: numa prova entregue o prazo é
  // história, e pintá-lo de vermelho seria alarme sobre o que já foi resolvido.
  const prazo = pendente && avaliacao.situacao !== 'AGENDADA' ? urgenciaDoPrazo(prazoDoEstudante(avaliacao)) : null;

  return (
    <li className="item-lista">
      <span className="item-lista-icone" aria-hidden="true">
        <IconeProva />
      </span>
      <div className="item-lista-info">
        <p className="item-lista-titulo">{avaliacao.titulo}</p>
        <p className="item-lista-apoio">
          <span className={etiqueta}>{rotulo}</span>{' · '}
          {avaliacao.situacao === 'AGENDADA' ? (
            `abre em ${formatarDataHora(avaliacao.dataInicio)}`
          ) : prazo ? (
            <>
              <strong className={`prazo prazo-${prazo.nivel}`}>{prazo.texto}</strong> ·{' '}
              {formatarDataHora(avaliacao.dataFim)}
            </>
          ) : (
            `prazo até ${formatarDataHora(avaliacao.dataFim)}`
          )}{' '}
          · {formatarDuracao(avaliacao.duracaoMinutos)} · {avaliacao.totalQuestoes}{' '}
          {avaliacao.totalQuestoes === 1 ? 'questão' : 'questões'}
        </p>
        {/* A nota só existe aqui se o professor já liberou os resultados (P-07). */}
        {resultado ? (
          <p className="item-lista-apoio">
            <strong>
              Nota: {formatarPontos(resultado.nota)} de {formatarPontos(resultado.pontuacaoMaxima)}
            </strong>
          </p>
        ) : (
          !descricaoDaSituacao(avaliacao).pendente && <p className="item-lista-apoio">Nota ainda não liberada</p>
        )}
      </div>
      {/* `?turma=` diz de onde o estudante veio: é por ele que o "Voltar" da prova
          sabe trazer de volta para esta turma, em vez de despejar na lista geral. */}
      <Link
        className="botao botao-secundario botao-pequeno"
        to={`/estudante/avaliacoes/${avaliacao.id}?turma=${turmaId}`}
        onClick={() => avaliacao.podeContinuar && pedirTelaCheia()}
      >
        {acao}
      </Link>
    </li>
  );
}

export function TurmaEstudante() {
  const { id } = useParams();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState('pendentes');

  useEffect(() => {
    let ativo = true;
    setDados(null);
    setErro('');
    api(`/estudante/turmas/${id}`)
      .then((resposta) => ativo && setDados(resposta))
      .catch((falha) => ativo && setErro(falha.message));
    return () => {
      ativo = false;
    };
  }, [id]);

  if (erro) {
    return (
      <Layout titulo="Turma">
        <div className="conteudo-central">
          <Aviso tipo="erro">{erro}</Aviso>
          <Link className="link-voltar" to="/estudante/turmas">
            <IconeSeta />
            Voltar para minhas turmas
          </Link>
        </div>
      </Layout>
    );
  }

  if (!dados) {
    return (
      <Layout titulo="Turma">
        <div className="conteudo-central">
          <Carregando mensagem="Abrindo a turma…" />
        </div>
      </Layout>
    );
  }

  const { turma, avaliacoes, colegas = [] } = dados;
  const pendentes = avaliacoes.filter((a) => descricaoDaSituacao(a).pendente);
  const concluidas = avaliacoes.filter((a) => !descricaoDaSituacao(a).pendente);
  const lista = filtro === 'pendentes' ? pendentes : filtro === 'concluidas' ? concluidas : avaliacoes;
  // O "próximo prazo" é a primeira pendente — a lista já vem ordenada por data de fim.
  const proxima = pendentes[0];

  return (
    <Layout titulo={`Turma ${turma.nome}`}>
      <div className="conteudo-central">
        {/* Volta ao início, e não à lista de turmas: "Minhas turmas" aqui convidava a
            abrir OUTRA turma, que não é o que alguém quer ao sair desta. E a lista já
            está no menu lateral, a um clique — este botão duplicava o caminho em vez de
            oferecer a saída que falta. Mesma decisão da turma do professor. */}
        <Link className="link-voltar" to="/estudante">
          <IconeSeta />
          Início
        </Link>

        <header className="capa capa-com-acoes">
          <div>
            <h1>{turma.nome}</h1>
            <span className="capa-apoio">
              {turma.professor}
              {!turma.turmaAtiva && ' · turma encerrada'}
            </span>
            {turma.descricao && <span className="capa-apoio">{turma.descricao}</span>}
          </div>
          {/* Sair da turma é ação sobre a turma aberta, então vive aqui também (DS-12). */}
          {turma.situacao !== 'RECUSADA' && (
            <CancelarInscricao
              turma={{ id: turma.id, nome: turma.nome, situacao: turma.situacao }}
              aoSair={() => navegar('/estudante/turmas', { replace: true })}
              aoFalhar={setErro}
            />
          )}
        </header>

        {turma.situacao !== 'APROVADA' ? (
          <div className="cartao">
            <EstadoVazio
              Icone={IconeRelogio}
              titulo={turma.situacao === 'PENDENTE' ? 'Sua entrada ainda está em análise' : 'Entrada não aprovada'}
            >
              {turma.situacao === 'PENDENTE'
                ? 'As provas desta turma aparecem aqui assim que o professor aprovar a sua entrada.'
                : 'O professor não aprovou a sua entrada nesta turma. Procure o professor para entender o motivo.'}
            </EstadoVazio>
          </div>
        ) : (
          <>
          <div className="colunas-resumo">
            <aside className="cartao">
              <h2 className="cartao-titulo">Próximo prazo</h2>
              {proxima ? (
                <>
                  <p className="item-lista-titulo">{proxima.titulo}</p>
                  {/* O cartão existe para dizer o que vem primeiro: é aqui que a
                      urgência pesa mais, e não na linha da lista ao lado. */}
                  {proxima.situacao === 'AGENDADA' ? (
                    <p className="item-lista-apoio">Abre em {formatarDataHora(proxima.dataInicio)}</p>
                  ) : (
                    <>
                      <p className="item-lista-apoio sem-margem">
                        <strong className={`prazo prazo-${urgenciaDoPrazo(prazoDoEstudante(proxima)).nivel}`}>
                          {urgenciaDoPrazo(prazoDoEstudante(proxima)).texto}
                        </strong>
                      </p>
                      <p className="item-lista-apoio">{formatarDataHora(proxima.dataFim)}</p>
                    </>
                  )}
                  <Link
                    className="botao botao-bloco"
                    to={`/estudante/avaliacoes/${proxima.id}?turma=${turma.id}`}
                    onClick={() => proxima.podeContinuar && pedirTelaCheia()}
                  >
                    {descricaoDaSituacao(proxima).acao}
                  </Link>
                </>
              ) : (
                <p className="texto-suave sem-margem">Nenhuma prova pendente nesta turma.</p>
              )}
            </aside>

            <section>
              <div className="secao-topo">
                <div>
                  <h2>Provas da turma</h2>
                  <p>
                    {pendentes.length} a fazer · {concluidas.length}{' '}
                    {concluidas.length === 1 ? 'concluída' : 'concluídas'}
                  </p>
                </div>
              </div>

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

              <div className="cartao">
                {lista.length === 0 ? (
                  <EstadoVazio
                    Icone={IconeProva}
                    titulo={
                      avaliacoes.length === 0
                        ? 'Esta turma ainda não tem provas'
                        : filtro === 'pendentes'
                          ? 'Nada pendente por aqui'
                          : 'Nenhuma prova concluída ainda'
                    }
                  >
                    {avaliacoes.length === 0
                      ? 'Quando o professor publicar uma avaliação para esta turma, ela aparece aqui.'
                      : 'Use os filtros acima para ver as outras provas da turma.'}
                  </EstadoVazio>
                ) : (
                  <ul className="lista-simples sem-margem">
                    {lista.map((a) => (
                      <LinhaDaProva key={a.id} avaliacao={a} turmaId={turma.id} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* Quem mais está na turma. Mesma lista do professor, sem o botão de remover
              — remover é dele — e sem o e-mail de ninguém: entre colegas, o nome basta
              para saber com quem se divide a turma, e o endereço de cada um não. */}
          <section>
            <div className="secao-topo">
              <div>
                <h2>Participantes</h2>
                <p>
                  {colegas.length} {colegas.length === 1 ? 'estudante na turma' : 'estudantes na turma'}.
                </p>
              </div>
            </div>
            <div className="cartao">
              {colegas.length === 0 ? (
                <EstadoVazio Icone={IconePessoa} titulo="Ninguém mais entrou ainda">
                  Quando outros estudantes entrarem nesta turma, eles aparecem aqui.
                </EstadoVazio>
              ) : (
                <ul className="lista-simples sem-margem">
                  {colegas.map((c) => (
                    <li className="item-lista" key={c.id}>
                      <span className="item-lista-icone" aria-hidden="true">
                        <IconePessoa />
                      </span>
                      <div className="item-lista-info">
                        <p className="item-lista-titulo">{c.nome}</p>
                        {c.voce && <p className="item-lista-apoio">você</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          </>
        )}
      </div>
    </Layout>
  );
}
