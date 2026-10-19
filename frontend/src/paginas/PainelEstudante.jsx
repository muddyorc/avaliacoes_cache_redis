// Tela inicial do estudante (UC08, passo 1).
//
// Reúne, no formato do Design System, o que o estudante já tinha acesso em outras
// telas: as provas com prazo próximo e as turmas em que está. Nenhum dado novo é
// buscado no servidor — são as mesmas rotas de `/estudante/avaliacoes` e
// `/estudante/turmas`, só apresentadas como ponto de partida.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/ContextoAuth.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { EstadoVazio } from '../componentes/EstadoVazio.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { primeiroNome } from '../utils/texto.js';
import { IconeRelogio, IconeTurma } from '../componentes/Icones.jsx';
import { CancelarInscricao } from '../componentes/CancelarInscricao.jsx';
import { formatarDataHora, prazoDoEstudante, urgenciaDoPrazo } from '../utils/datas.js';
import { pedirTelaCheia } from '../utils/telaCheia.js';

// O que tem prazo a acompanhar: prova em andamento, disponível agora ou agendada.
// Entregue e encerrada saem daqui — pertencem à lista completa de avaliações.
const ACOMPANHAR = ['EM_ANDAMENTO', 'DISPONIVEL', 'AGENDADA'];
const LIMITE_PRAZOS = 3;

function situacaoDoPrazo(avaliacao) {
  if (avaliacao.situacao === 'EM_ANDAMENTO') return { rotulo: 'Em andamento', acao: 'Continuar' };
  if (avaliacao.situacao === 'AGENDADA') return { rotulo: 'Abre em breve', acao: 'Ver detalhes' };
  return { rotulo: 'Disponível agora', acao: 'Fazer prova' };
}

function SituacaoDaTurma({ situacao, ativa }) {
  if (situacao === 'PENDENTE') return <span className="selo-alerta">Aguardando aprovação</span>;
  if (!ativa) return <span className="texto-suave">Turma inativa</span>;
  return null;
}

export function PainelEstudante() {
  const { usuario } = useAuth();
  const [avaliacoes, setAvaliacoes] = useState(null);
  const [turmas, setTurmas] = useState(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    let ativo = true;
    Promise.all([api('/estudante/avaliacoes'), api('/estudante/turmas')])
      .then(([listaAvaliacoes, listaTurmas]) => {
        if (!ativo) return;
        setAvaliacoes(listaAvaliacoes.avaliacoes);
        setTurmas(listaTurmas.turmas);
      })
      .catch((falha) => ativo && setErro(falha.message));
    return () => {
      ativo = false;
    };
  }, []);

  const carregando = !avaliacoes && !turmas && !erro;
  const prazos = (avaliacoes ?? [])
    .filter((a) => ACOMPANHAR.includes(a.situacao))
    // Quem entrega primeiro aparece primeiro; prova em andamento sempre no topo.
    .sort((a, b) => {
      if (a.situacao === 'EM_ANDAMENTO' && b.situacao !== 'EM_ANDAMENTO') return -1;
      if (b.situacao === 'EM_ANDAMENTO' && a.situacao !== 'EM_ANDAMENTO') return 1;
      return new Date(a.dataFim) - new Date(b.dataFim);
    })
    .slice(0, LIMITE_PRAZOS);
  const turmasVisiveis = (turmas ?? []).filter((t) => t.situacao !== 'RECUSADA');

  return (
    <Layout titulo="Início do estudante">
      <div className="conteudo-central">
        <div className="saudacao">
          <h1>Olá, {primeiroNome(usuario.nome)}</h1>
          <p>Suas provas e turmas em um só lugar.</p>
        </div>

        <Aviso tipo="erro">{erro}</Aviso>
        <Aviso tipo="sucesso">{mensagem}</Aviso>
        {carregando && <Carregando mensagem="Carregando suas provas e turmas…" />}

        {avaliacoes && (
          <section className="cartao">
            <div className="secao-topo">
              <div>
                <h2>O prazo está próximo</h2>
                <p>Provas que ainda pedem alguma coisa de você.</p>
              </div>
              <Link className="link-acao" to="/estudante/avaliacoes">
                Ver todas as avaliações
              </Link>
            </div>

            {prazos.length === 0 ? (
              <EstadoVazio Icone={IconeRelogio} titulo="Nenhuma prova com prazo aberto">
                Quando um professor publicar uma avaliação para você, ela aparece aqui.
              </EstadoVazio>
            ) : (
              <ul className="lista-simples sem-margem">
                {prazos.map((a) => {
                  const { rotulo, acao } = situacaoDoPrazo(a);
                  const prazo = urgenciaDoPrazo(prazoDoEstudante(a));
                  return (
                    <li className="item-lista" key={a.id}>
                      <span className="item-lista-icone" aria-hidden="true">
                        <IconeRelogio />
                      </span>
                      <div className="item-lista-info">
                        <p className="item-lista-titulo">{a.titulo}</p>
                        {/* Quanto falta primeiro, a data depois: a urgência é o que
                            muda a decisão de hoje; a data é o que se anota na agenda. */}
                        <p className="item-lista-apoio">
                          <strong className={`prazo prazo-${prazo.nivel}`}>{prazo.texto}</strong> ·{' '}
                          {formatarDataHora(prazoDoEstudante(a))}
                        </p>
                        <p className="item-lista-apoio">
                          {rotulo} · {a.professor}
                        </p>
                      </div>
                      {/* `?de=inicio`: quem abriu a prova daqui volta para cá, e não
                          para a lista de avaliações, que ele nem chegou a ver. */}
                      {/* O clique é o gesto que o navegador exige para conceder a tela
                          cheia, e a aplicação é de página única — então pedir aqui faz a
                          prova já abrir nela. Só para quem vai CONTINUAR: quem ainda
                          não começou passa pela tela de instruções, onde a confirmação
                          de "Iniciar" faz o mesmo pedido. */}
                      <Link
                        className="botao botao-secundario botao-pequeno"
                        to={`/estudante/avaliacoes/${a.id}?de=inicio`}
                        onClick={() => a.podeContinuar && pedirTelaCheia()}
                      >
                        {acao}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {turmas && (
          <section>
            <div className="secao-topo">
              <div>
                <h2>Minhas turmas</h2>
                <p>Turmas em que você entrou com o código do professor.</p>
              </div>
              <Link className="link-acao" to="/estudante/turmas">
                Entrar em uma turma
              </Link>
            </div>

            {turmasVisiveis.length === 0 ? (
              <div className="cartao">
                <EstadoVazio
                  Icone={IconeTurma}
                  titulo="Você ainda não está em nenhuma turma"
                  acao={
                    <Link className="botao" to="/estudante/turmas">
                      Entrar com um código
                    </Link>
                  }
                >
                  O professor entrega um código de acesso; com ele você entra na turma e passa a
                  ver as provas dela.
                </EstadoVazio>
              </div>
            ) : (
              <ul className="grade-cartoes">
                {turmasVisiveis.map((t) => (
                  <li key={t.id}>
                    <article className="cartao-turma">
                      <Link className="cartao-turma-alvo" to={`/estudante/turmas/${t.id}`}>
                        <div className="cartao-turma-capa">
                          <span className="cartao-turma-nome">{t.nome}</span>
                          <span className="cartao-turma-professor">{t.professor}</span>
                        </div>
                        <div className="cartao-turma-corpo">
                          <SituacaoDaTurma situacao={t.situacao} ativa={t.turmaAtiva} />
                          {t.descricao && <span className="quebra">{t.descricao}</span>}
                        </div>
                      </Link>
                      <div className="cartao-turma-rodape">
                        <CancelarInscricao
                          turma={t}
                          aoSair={(aviso, turma) => {
                            setTurmas((atuais) => atuais.filter((x) => x.id !== turma.id));
                            setMensagem(aviso);
                            setErro('');
                          }}
                          aoFalhar={setErro}
                        />
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
