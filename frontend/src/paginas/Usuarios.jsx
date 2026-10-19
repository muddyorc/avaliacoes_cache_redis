// UC02 — o administrador gerencia usuários e perfis (RF02).
//
// Não existe botão de excluir: pelo Quadro 31 do DERS e por P-02, contas são inativadas,
// nunca apagadas. O histórico do usuário continua ligado ao registro.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/ContextoAuth.jsx';
import { api } from '../api/client.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { FormularioUsuario } from '../componentes/FormularioUsuario.jsx';

const PERFIS = [
  { valor: 'ADMINISTRADOR', rotulo: 'Administrador' },
  { valor: 'PROFESSOR', rotulo: 'Professor' },
  { valor: 'ESTUDANTE', rotulo: 'Estudante' },
];

const ROTULO_PERFIL = Object.fromEntries(PERFIS.map((p) => [p.valor, p.rotulo]));
const TAMANHO_PAGINA = 10;

export function Usuarios() {
  const { usuario: eu } = useAuth();

  // `busca` é o que está digitado; `buscaAplicada` é o que foi efetivamente enviado ao
  // servidor. Separar os dois evita uma requisição a cada tecla digitada.
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [filtroPerfil, setFiltroPerfil] = useState('');
  const [filtroSituacao, setFiltroSituacao] = useState('');
  const [pagina, setPagina] = useState(1);

  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [editando, setEditando] = useState(null); // null | 'novo' | usuário
  const [ocupado, setOcupado] = useState(null); // id da linha em operação

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const parametros = new URLSearchParams({ pagina: String(pagina), tamanho: String(TAMANHO_PAGINA) });
      if (buscaAplicada) parametros.set('busca', buscaAplicada);
      if (filtroPerfil) parametros.set('perfil', filtroPerfil);
      if (filtroSituacao) parametros.set('situacao', filtroSituacao);
      setDados(await api(`/usuarios?${parametros}`));
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setCarregando(false);
    }
  }, [buscaAplicada, filtroPerfil, filtroSituacao, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Qualquer mudança de filtro volta para a primeira página: continuar na página 5 de um
  // resultado que agora tem 1 página mostraria uma lista vazia sem explicação.
  function aplicarFiltro(acao) {
    setPagina(1);
    acao();
  }

  async function alternarSituacao(alvo) {
    const nova = alvo.situacao === 'ATIVO' ? 'INATIVO' : 'ATIVO';
    setOcupado(alvo.id);
    setErro('');
    setMensagem('');
    try {
      await api(`/usuarios/${alvo.id}/situacao`, { metodo: 'PATCH', corpo: { situacao: nova } });
      setMensagem(`${alvo.nome} agora está ${nova === 'ATIVO' ? 'ativo' : 'inativo'}.`);
      await carregar();
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(null);
    }
  }

  async function aoSalvar(valores, id) {
    if (id) {
      await api(`/usuarios/${id}`, { metodo: 'PATCH', corpo: valores });
      setMensagem('Usuário atualizado.');
    } else {
      await api('/usuarios', { metodo: 'POST', corpo: valores });
      setMensagem('Usuário cadastrado.');
    }
    setEditando(null);
    await carregar();
  }

  if (editando) {
    return (
      <FormularioUsuario
        usuario={editando === 'novo' ? null : editando}
        perfis={PERFIS}
        aoSalvar={aoSalvar}
        aoCancelar={() => setEditando(null)}
      />
    );
  }

  return (
    <main className="pagina pagina-larga">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>Usuários</h1>
          <p>Cadastre, edite, ative e inative contas. Contas nunca são excluídas.</p>
        </div>
        <Link className="botao botao-secundario" to="/administrador">
          Voltar
        </Link>
      </header>

      <section className="painel">
        <div className="barra-acoes">
          <button className="botao" type="button" onClick={() => setEditando('novo')}>
            Cadastrar usuário
          </button>
        </div>

        <form
          className="filtros"
          onSubmit={(e) => {
            e.preventDefault();
            setPagina(1);
            // Só aqui a busca digitada vira filtro de verdade.
            setBuscaAplicada(busca.trim());
          }}
        >
          <Campo
            id="busca"
            rotulo="Buscar por nome ou e-mail"
            name="busca"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />

          <div className="campo">
            <label htmlFor="filtroPerfil">Perfil</label>
            <select
              id="filtroPerfil"
              value={filtroPerfil}
              onChange={(e) => aplicarFiltro(() => setFiltroPerfil(e.target.value))}
            >
              <option value="">Todos</option>
              {PERFIS.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.rotulo}
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
              <option value="">Todas</option>
              <option value="ATIVO">Ativos</option>
              <option value="INATIVO">Inativos</option>
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
            {dados.usuarios.length === 0 ? (
              <p className="texto-suave">Nenhum usuário encontrado com estes filtros.</p>
            ) : (
              <div className="tabela-rolavel">
                <table className="tabela">
                  <caption className="apenas-leitor">Lista de usuários cadastrados</caption>
                  <thead>
                    <tr>
                      <th scope="col">Nome</th>
                      <th scope="col">E-mail</th>
                      <th scope="col">Perfil</th>
                      <th scope="col">Situação</th>
                      <th scope="col">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.usuarios.map((u) => {
                      const souEu = u.id === eu.id;
                      return (
                        <tr key={u.id}>
                          <td>
                            {u.nome}
                            {souEu && <span className="etiqueta"> você</span>}
                          </td>
                          <td className="quebra">{u.email}</td>
                          <td>{ROTULO_PERFIL[u.perfil]}</td>
                          <td>
                            <span className={u.situacao === 'ATIVO' ? 'situacao-ativa' : 'situacao-inativa'}>
                              {u.situacao === 'ATIVO' ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                          <td className="acoes">
                            <button className="botao botao-secundario botao-pequeno" type="button" onClick={() => setEditando(u)}>
                              Editar
                            </button>
                            <button
                              className="botao botao-secundario botao-pequeno"
                              type="button"
                              disabled={souEu || ocupado === u.id}
                              // Inativar a própria conta derrubaria a sessão de quem está
                              // usando a tela; o backend também recusa.
                              title={souEu ? 'Você não pode inativar a sua própria conta.' : undefined}
                              onClick={() => alternarSituacao(u)}
                            >
                              {u.situacao === 'ATIVO' ? 'Inativar' : 'Ativar'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
                Página {dados.pagina} de {dados.paginas} · {dados.total} usuário(s)
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
    </main>
  );
}
