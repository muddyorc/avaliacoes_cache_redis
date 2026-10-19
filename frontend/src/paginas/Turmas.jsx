// UC06 — turmas do professor (RF06). "Excluir" é inativar (Quadro 31).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Layout } from '../componentes/Layout.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { CodigoTurma } from '../componentes/CodigoTurma.jsx';

export function Turmas() {
  const [situacao, setSituacao] = useState('ATIVA');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [ocupado, setOcupado] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setDados(await api(`/turmas?situacao=${situacao}`));
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setCarregando(false);
    }
  }, [situacao]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function alternarSituacao(turma) {
    const nova = turma.situacao === 'ATIVA' ? 'INATIVA' : 'ATIVA';
    if (
      nova === 'INATIVA' &&
      !window.confirm(`Inativar "${turma.nome}"? Os estudantes continuam registrados, mas ninguém mais entra pelo código.`)
    ) {
      return;
    }
    setOcupado(turma.id);
    setErro('');
    setMensagem('');
    try {
      await api(`/turmas/${turma.id}/situacao`, { metodo: 'PATCH', corpo: { situacao: nova } });
      setMensagem(nova === 'INATIVA' ? 'Turma inativada. Nada foi apagado.' : 'Turma reativada.');
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    // Dentro do Layout: o menu lateral acompanha a tela, como no Início. Esta página
    // usava `<main>` próprio e ficava sem navegação — quem chegava aqui só saía pelo
    // botão do navegador. O Layout já tem o seu `<main>`, então aqui vai uma `<div>`.
    <Layout titulo="Turmas">
      <div className="conteudo-central">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>Turmas</h1>
          <p>Compartilhe o código com os estudantes para que entrem na turma. Turmas nunca são apagadas.</p>
        </div>
        <Link className="botao botao-secundario" to="/professor">
          Voltar
        </Link>
      </header>

      <section className="painel">
        <div className="barra-acoes">
          <Link className="botao" to="/professor/turmas/nova">
            Nova turma
          </Link>
        </div>

        <div className="abas" role="tablist" aria-label="Situação das turmas">
          {[
            ['ATIVA', 'Ativas'],
            ['INATIVA', 'Inativas'],
          ].map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={situacao === valor}
              className={`aba${situacao === valor ? ' aba-ativa' : ''}`}
              onClick={() => {
                setMensagem('');
                setSituacao(valor);
              }}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <Aviso tipo="erro">{erro}</Aviso>
        <Aviso tipo="sucesso">{mensagem}</Aviso>
        {carregando && <Carregando />}

        {dados && !carregando && (
          dados.turmas.length === 0 ? (
            <p className="texto-suave">
              {situacao === 'ATIVA' ? 'Nenhuma turma ainda. Comece por "Nova turma".' : 'Nenhuma turma inativa.'}
            </p>
          ) : (
            <ul className="lista-questoes">
              {dados.turmas.map((t) => (
                <li key={t.id} className={`cartao-questao${t.situacao === 'INATIVA' ? ' cartao-inativo' : ''}`}>
                  <div className="cartao-meta">
                    <span className="selo selo-neutro">{t.requerAprovacao ? 'Entrada com aprovação' : 'Entrada direta'}</span>
                    <span className="texto-suave">
                      {t.totalEstudantes} {t.totalEstudantes === 1 ? 'estudante' : 'estudantes'} · {t.totalAvaliacoes}{' '}
                      {t.totalAvaliacoes === 1 ? 'avaliação' : 'avaliações'}
                    </span>
                    {t.totalPendentes > 0 && (
                      <span className="selo selo-alerta">
                        {t.totalPendentes} {t.totalPendentes === 1 ? 'solicitação' : 'solicitações'}
                      </span>
                    )}
                  </div>
                  <p className="cartao-titulo">
                    <Link to={`/professor/turmas/${t.id}`}>{t.nome}</Link>
                  </p>
                  {t.situacao === 'ATIVA' && <CodigoTurma codigo={t.codigoAcesso} compacto />}
                  <div className="acoes espaco-acima-pequeno">
                    <Link className="botao botao-secundario botao-pequeno" to={`/professor/turmas/${t.id}`}>
                      Abrir
                    </Link>
                    {/* Editar direto da lista: antes era preciso abrir a turma para
                        depois clicar em "Editar turma". Duas das três ações do cartão já
                        estavam aqui; a terceira faltava sem motivo. */}
                    <Link className="botao botao-secundario botao-pequeno" to={`/professor/turmas/${t.id}/editar`}>
                      Editar
                    </Link>
                    <button
                      className="botao botao-secundario botao-pequeno"
                      type="button"
                      disabled={ocupado === t.id}
                      onClick={() => alternarSituacao(t)}
                    >
                      {t.situacao === 'ATIVA' ? 'Inativar' : 'Reativar'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
        </section>
      </div>
    </Layout>
  );
}
