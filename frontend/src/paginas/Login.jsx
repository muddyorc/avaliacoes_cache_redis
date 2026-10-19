// UC01 — tela de login (RF01).
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { caminhoInicial, useAuth } from '../auth/ContextoAuth.jsx';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { MarcaPublica } from '../componentes/MarcaPublica.jsx';

export function Login() {
  const { entrar } = useAuth();
  const navegar = useNavigate();
  const local = useLocation();

  // Quem chega do cadastro com a conta criada mas sem a entrada automática traz o aviso
  // e o próprio e-mail no estado da navegação — não faz sentido pedir que redigite o que
  // acabou de cadastrar.
  const [email, setEmail] = useState(local.state?.email ?? '');
  const [senha, setSenha] = useState('');
  const [aviso] = useState(local.state?.aviso ?? '');
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento) {
    evento.preventDefault();
    setErro('');
    setCampos({});
    setEnviando(true);
    try {
      const usuario = await entrar(email, senha);
      // Volta para a página que o usuário tentou abrir antes de ser mandado ao login;
      // se não havia nenhuma, vai para a área do seu perfil.
      navegar(local.state?.de || caminhoInicial(usuario), { replace: true });
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
      // A senha é limpa a cada erro; o e-mail permanece para não obrigar a redigitar.
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="pagina pagina-estreita">
      <MarcaPublica />
      <header className="cabecalho">
        <h1>Entrar</h1>
        <p>Sistema de Gerenciamento e Correção de Avaliações Digitais</p>
      </header>

      <form className="painel" onSubmit={aoEnviar} noValidate>
        {!erro && <Aviso tipo="sucesso">{aviso}</Aviso>}
        <Aviso tipo="erro">{erro}</Aviso>

        <Campo
          id="email"
          rotulo="E-mail"
          type="email"
          name="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          erro={campos.email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Campo
          id="senha"
          rotulo="Senha"
          type="password"
          name="senha"
          autoComplete="current-password"
          required
          value={senha}
          erro={campos.senha}
          onChange={(e) => setSenha(e.target.value)}
        />

        <button className="botao botao-bloco" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="rodape-form">
          <Link to="/recuperar-senha">Esqueci minha senha</Link>
        </p>
        <p className="rodape-form">
          Ainda não tem conta? <Link to="/cadastro">Criar conta</Link>
        </p>
      </form>
    </main>
  );
}
