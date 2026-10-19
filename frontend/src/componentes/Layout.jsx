// Estrutura das telas internas: barra superior fixa, navegação lateral e conteúdo.
//
// É o esqueleto reutilizável do Design System — nenhuma tela desenha a própria barra
// ou o próprio menu. A navegação lista **apenas rotas que já existem** para o perfil;
// não há item para funcionalidade que o sistema ainda não tem.
//
// No computador a lateral é um trilho de ícones que se abre ao passar o mouse (ou ao
// receber foco pelo teclado); no telefone ela vira uma gaveta, aberta pelo botão de menu
// da barra. Nos dois casos é a mesma navegação, na mesma ordem, sem uma segunda versão
// do componente — o que muda é só CSS.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/ContextoAuth.jsx';
import { AlternarTema } from './AlternarTema.jsx';
import { SinoAvisos } from './SinoAvisos.jsx';
import {
  IconeBanco,
  IconeGrafico,
  IconeInicio,
  IconeMenu,
  IconePessoa,
  IconePessoas,
  IconeProva,
  IconeSair,
  IconeTurma,
} from './Icones.jsx';

const ROTULO_PERFIL = {
  ADMINISTRADOR: 'Administrador',
  PROFESSOR: 'Professor',
  ESTUDANTE: 'Estudante',
};

// Só rotas implementadas. Ao concluir uma etapa nova, o item entra aqui.
const NAVEGACAO = {
  ESTUDANTE: [
    { para: '/estudante', rotulo: 'Início', Icone: IconeInicio, exata: true },
    { para: '/estudante/avaliacoes', rotulo: 'Avaliações', Icone: IconeProva },
    { para: '/estudante/turmas', rotulo: 'Minhas turmas', Icone: IconeTurma },
    { para: '/meus-dados', rotulo: 'Meus dados', Icone: IconePessoa },
  ],
  PROFESSOR: [
    { para: '/professor', rotulo: 'Início', Icone: IconeInicio, exata: true },
    // "Avaliações" saiu do menu (15/10/2026): a prova pertence a uma turma, e é na turma
    // que ela aparece — como a atividade aparece na turma do Google Classroom. Uma
    // listagem solta existia só porque a prova não tinha lugar.
    { para: '/professor/questoes', rotulo: 'Banco de questões', Icone: IconeBanco },
    { para: '/professor/turmas', rotulo: 'Turmas', Icone: IconeTurma },
    // Um item, não dois: "Resultados" (RF13) e "Desempenho" (RF12) viraram a mesma tela
    // (item 3 do feedback do orientador). "geral" diz que aqui a turma é escolhível —
    // entrando por uma turma, o painel abre travado nela.
    { para: '/professor/dashboard', rotulo: 'Desempenho geral', Icone: IconeGrafico },
    { para: '/meus-dados', rotulo: 'Meus dados', Icone: IconePessoa },
  ],
  ADMINISTRADOR: [
    { para: '/administrador', rotulo: 'Início', Icone: IconeInicio, exata: true },
    { para: '/administrador/usuarios', rotulo: 'Usuários', Icone: IconePessoas },
    { para: '/meus-dados', rotulo: 'Meus dados', Icone: IconePessoa },
  ],
};

const iniciais = (nome = '') =>
  nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('');

function MenuDoUsuario({ usuario, aoSair, saindo }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef(null);

  // Fecha ao clicar fora ou com Esc — o comportamento que se espera de um menu.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (e) => {
      if (!caixa.current?.contains(e.target)) setAberto(false);
    };
    const aoTeclar = (e) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  return (
    <div className="menu-usuario" ref={caixa}>
      <button
        type="button"
        className="avatar"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Conta de ${usuario.nome}`}
      >
        {iniciais(usuario.nome) || '?'}
      </button>

      {aberto && (
        <div className="menu-flutuante" role="menu">
          <div className="menu-cabecalho">
            <p className="sem-margem">
              <strong>{usuario.nome}</strong>
            </p>
            <p className="texto-suave sem-margem quebra">{usuario.email}</p>
            <span className="etiqueta">{ROTULO_PERFIL[usuario.perfil]}</span>
          </div>
          <Link className="menu-item" role="menuitem" to="/meus-dados" onClick={() => setAberto(false)}>
            <IconePessoa className="icone" />
            Meus dados
          </Link>
          <button className="menu-item" role="menuitem" type="button" onClick={aoSair} disabled={saindo}>
            <IconeSair className="icone" />
            {saindo ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout({ children, titulo }) {
  const { usuario, sair } = useAuth();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const local = useLocation();
  const navegar = useNavigate();

  // Navegar fecha a gaveta: no telefone, o destino precisa aparecer inteiro.
  useEffect(() => setGavetaAberta(false), [local.pathname]);

  useEffect(() => {
    if (!gavetaAberta) return undefined;
    const aoTeclar = (e) => e.key === 'Escape' && setGavetaAberta(false);
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [gavetaAberta]);

  const itens = NAVEGACAO[usuario?.perfil] ?? [];

  async function aoSair() {
    setSaindo(true);
    try {
      await sair();
      navegar('/entrar', { replace: true });
    } finally {
      setSaindo(false);
    }
  }

  return (
    <div className="app">
      <header className="app-topo">
        <button
          type="button"
          className="botao-icone apenas-telefone"
          onClick={() => setGavetaAberta((v) => !v)}
          aria-label={gavetaAberta ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={gavetaAberta}
        >
          <IconeMenu />
        </button>

        {/* O logo é desenhado como máscara, e não como imagem: assim ele toma a cor da
            marca do tema em uso. O arquivo é azul escuro, que sumiria no modo noturno.
            O nome fica no `aria-label`, porque para quem usa leitor de tela a imagem não
            diz nada. */}
        <Link className="marca" to="/" aria-label="Avaliune — ir para a página inicial">
          <span className="marca-logo" aria-hidden="true" />
        </Link>

        <div className="app-topo-acoes">
          {/* Só para o estudante: os dois avisos que o sino mostra — prazo chegando e
              nota liberada — são coisas que o PROFESSOR provoca, não recebe. Dar a ele
              um sino que nunca toca seria um controle vazio na barra. */}
          {usuario?.perfil === 'ESTUDANTE' && <SinoAvisos />}
          <AlternarTema />
          {usuario && <MenuDoUsuario usuario={usuario} aoSair={aoSair} saindo={saindo} />}
        </div>
      </header>

      <div className="app-corpo">
        {/* A mesma lista serve à lateral fixa do desktop e à gaveta do telefone. */}
        <nav className={`app-lateral ${gavetaAberta ? 'app-lateral-aberta' : ''}`} aria-label="Navegação principal">
          <ul className="nav-lista">
            {itens.map(({ para, rotulo, Icone, exata }) => (
              <li key={para}>
                <NavLink
                  to={para}
                  end={exata}
                  // Com a lateral fechada só se vê o ícone: a dica do navegador dá o
                  // nome sem precisar abri-la.
                  title={rotulo}
                  className={({ isActive }) => `nav-item ${isActive ? 'nav-item-ativo' : ''}`}
                >
                  <Icone className="icone" />
                  <span>{rotulo}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {gavetaAberta && (
          <button
            type="button"
            className="app-veu"
            aria-label="Fechar menu"
            onClick={() => setGavetaAberta(false)}
          />
        )}

        <main className="app-conteudo" id="conteudo">
          {titulo && <h1 className="apenas-leitor">{titulo}</h1>}
          {children}
        </main>
      </div>
    </div>
  );
}
