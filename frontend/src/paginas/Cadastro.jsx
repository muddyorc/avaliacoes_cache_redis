// UC03 — autocadastro (RF02).
//
// Estudante ou professor, com a conta pronta para usar na hora. Até 13/10/2026 só o
// estudante se cadastrava e o professor dependia do administrador (P-18); a reversão foi
// pedida pelo orientador, porque cadastro manual de professor não escala.
//
// ADMINISTRADOR não está entre as opções e não pode ser forjado no corpo da requisição:
// a rota pública valida contra uma lista de dois, e o serviço repete a verificação.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/ContextoAuth.jsx';
import { api } from '../api/client.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { MarcaPublica } from '../componentes/MarcaPublica.jsx';

const SENHA_MINIMA = 8;

export function Cadastro() {
  const { entrar } = useAuth();
  const navegar = useNavigate();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  // Estudante como padrão: é quem mais se cadastra, e ninguém vira professor por
  // distração — precisa escolher.
  const [perfil, setPerfil] = useState('ESTUDANTE');
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento) {
    evento.preventDefault();
    setErro('');
    setCampos({});

    if (senha !== confirmacao) {
      setCampos({ confirmacao: 'As senhas não coincidem.' });
      return;
    }

    setEnviando(true);
    try {
      await api('/usuarios/cadastro', { metodo: 'POST', corpo: { nome, email, senha, perfil } });
    } catch (falha) {
      // A conta não foi criada: o erro é deste formulário e pede correção aqui.
      setErro(falha.message);
      setCampos(falha.campos || {});
      setEnviando(false);
      return;
    }

    // Daqui em diante **a conta existe**. Entrar é comodidade — obrigar a digitar de novo
    // o que acabou de ser digitado seria atrito sem ganho. Mas se a entrada falhar (a API
    // reiniciou, a rede caiu, o limitador de tentativas respondeu), o cadastro continua
    // feito, e tratar as duas falhas como uma só é o que produzia o pior desfecho
    // possível: a pessoa via um erro, tentava de novo e recebia "já existe uma conta com
    // este e-mail" — sobre a conta que ela mesma acabara de criar, sem saber.
    try {
      const usuario = await entrar(email, senha);
      navegar(usuario.perfil === 'ESTUDANTE' ? '/estudante' : '/professor', { replace: true });
    } catch {
      navegar('/entrar', {
        replace: true,
        state: {
          aviso: 'Sua conta foi criada. Entre com o e-mail e a senha que você acabou de cadastrar.',
          email,
        },
      });
    }
  }

  return (
    <main className="pagina pagina-estreita">
      <MarcaPublica />
      <header className="cabecalho">
        <h1>Criar conta</h1>
        <p>Estudante ou professor. A conta fica pronta para usar assim que você terminar.</p>
      </header>

      <form className="painel" onSubmit={aoEnviar} noValidate>
        <Aviso tipo="erro">{erro}</Aviso>

        {/* A escolha vem antes dos dados: ela muda o que a conta será, e descobrir isso
            depois de preencher tudo seria tarde. Administrador não está aqui nem pode ser
            forjado no corpo da requisição — a API recusa. */}
        <fieldset className="grupo-visibilidade">
          <legend>Você é</legend>
          <label className="opcao-descrita">
            <input
              type="radio"
              name="perfil"
              value="ESTUDANTE"
              checked={perfil === 'ESTUDANTE'}
              onChange={() => setPerfil('ESTUDANTE')}
            />
            <span>
              <strong>Estudante</strong> — entro em turmas pelo código que o professor passa e faço as
              avaliações.
            </span>
          </label>
          <label className="opcao-descrita">
            <input
              type="radio"
              name="perfil"
              value="PROFESSOR"
              checked={perfil === 'PROFESSOR'}
              onChange={() => setPerfil('PROFESSOR')}
            />
            <span>
              <strong>Professor</strong> — crio turmas, monto avaliações e corrijo as provas dos meus
              estudantes.
            </span>
          </label>
          {campos.perfil && <p className="campo-erro">{campos.perfil}</p>}
        </fieldset>

        <Campo
          id="nome"
          rotulo="Nome completo"
          name="nome"
          autoComplete="name"
          autoFocus
          required
          value={nome}
          erro={campos.nome}
          onChange={(e) => setNome(e.target.value)}
        />

        <Campo
          id="email"
          rotulo="E-mail"
          type="email"
          name="email"
          autoComplete="username"
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
          autoComplete="new-password"
          required
          minLength={SENHA_MINIMA}
          value={senha}
          erro={campos.senha}
          dica={`Mínimo de ${SENHA_MINIMA} caracteres.`}
          onChange={(e) => setSenha(e.target.value)}
        />

        <Campo
          id="confirmacao"
          rotulo="Repita a senha"
          type="password"
          name="confirmacao"
          autoComplete="new-password"
          required
          value={confirmacao}
          erro={campos.confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />

        <button className="botao botao-bloco" type="submit" disabled={enviando}>
          {enviando ? 'Criando conta…' : 'Criar conta'}
        </button>

        <p className="rodape-form">
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      </form>
    </main>
  );
}
