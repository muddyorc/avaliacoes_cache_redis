// Etapa 1 — placeholder da área de cada perfil.
//
// Existe apenas para validar o fluxo de autenticação de ponta a ponta: confirma que o
// login redireciona para o lugar certo, que a rota protegida do backend responde com a
// sessão e que o logout funciona. O conteúdo real de cada perfil chega nas etapas
// seguintes (RF02 em diante).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/ContextoAuth.jsx';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';

const ROTULO_PERFIL = {
  ADMINISTRADOR: 'Administrador',
  PROFESSOR: 'Professor',
  ESTUDANTE: 'Estudante',
};

// Funcionalidades já disponíveis para cada perfil.
const ATALHOS = {
  ADMINISTRADOR: [{ para: '/administrador/usuarios', rotulo: 'Gerenciar usuários e perfis' }],
  PROFESSOR: [
    { para: '/professor/questoes', rotulo: 'Banco de questões' },
    { para: '/professor/turmas', rotulo: 'Turmas' },
    { para: '/professor/dashboard', rotulo: 'Dashboard de desempenho' },
  ],
  ESTUDANTE: [
    { para: '/estudante/avaliacoes', rotulo: 'Avaliações' },
    { para: '/estudante/turmas', rotulo: 'Minhas turmas' },
  ],
};

export function Painel({ recurso }) {
  const { usuario, sair } = useAuth();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [saindo, setSaindo] = useState(false);

  // Confirma que a rota protegida do backend aceita esta sessão e este perfil.
  useEffect(() => {
    let ativo = true;
    api(recurso)
      .then((resposta) => ativo && setDados(resposta))
      .catch((falha) => ativo && setErro(falha.message));
    return () => {
      ativo = false;
    };
  }, [recurso]);

  async function aoSair() {
    setSaindo(true);
    try {
      await sair();
    } finally {
      setSaindo(false);
    }
  }

  return (
    <main className="pagina">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>Olá, {usuario.nome}</h1>
          <p>
            Perfil: <strong>{ROTULO_PERFIL[usuario.perfil]}</strong> · {usuario.email}
          </p>
        </div>
        <div className="barra-acoes">
          <Link className="botao botao-secundario" to="/meus-dados">
            Meus dados
          </Link>
          <button className="botao botao-secundario" type="button" onClick={aoSair} disabled={saindo}>
            {saindo ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      </header>

      <section className="painel">
        <h2>Área do {ROTULO_PERFIL[usuario.perfil].toLowerCase()}</h2>

        <Aviso tipo="erro">{erro}</Aviso>

        {!dados && !erro && <Carregando mensagem="Consultando a API…" />}

        {dados && (
          <>
            <p className="texto-suave">{dados.mensagem}</p>
            <p className="etiqueta-ok" role="status">
              Sessão autenticada e autorizada pelo servidor.
            </p>
          </>
        )}

        {ATALHOS[usuario.perfil].length > 0 && (
          <>
            <h3>Disponível agora</h3>
            <ul className="lista-atalhos">
              {ATALHOS[usuario.perfil].map((atalho) => (
                <li key={atalho.para}>
                  <Link to={atalho.para}>{atalho.rotulo}</Link>
                </li>
              ))}
            </ul>
          </>
        )}

      </section>
    </main>
  );
}
