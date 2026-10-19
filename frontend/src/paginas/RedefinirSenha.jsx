// UC01 A2 — cadastro da nova senha a partir do link recebido por e-mail (RF01).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { MarcaPublica } from '../componentes/MarcaPublica.jsx';

const SENHA_MINIMA = 8;

export function RedefinirSenha() {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const token = parametros.get('token') || '';

  // O link é conferido antes de mostrar o formulário, para não fazer a pessoa escolher
  // uma senha e só então descobrir que o link expirou.
  const [verificando, setVerificando] = useState(true);
  const [linkValido, setLinkValido] = useState(false);
  const [erroLink, setErroLink] = useState('');

  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    let ativo = true;
    if (!token) {
      setErroLink('O endereço não contém um link de redefinição válido.');
      setVerificando(false);
      return undefined;
    }
    api('/auth/redefinicao/verificar', { metodo: 'POST', corpo: { token } })
      .then(() => ativo && setLinkValido(true))
      .catch((falha) => ativo && setErroLink(falha.message))
      .finally(() => ativo && setVerificando(false));
    return () => {
      ativo = false;
    };
  }, [token]);

  async function aoEnviar(evento) {
    evento.preventDefault();
    setErro('');
    setCampos({});

    // Conferência local: a confirmação existe só para evitar erro de digitação, e por
    // isso não é enviada à API.
    if (senha !== confirmacao) {
      setCampos({ confirmacao: 'As senhas não coincidem.' });
      return;
    }

    setEnviando(true);
    try {
      await api('/auth/redefinicao', { metodo: 'POST', corpo: { token, senha } });
      setConcluido(true);
      // Leva ao login depois de dar tempo de ler a confirmação.
      setTimeout(() => navegar('/entrar', { replace: true }), 2500);
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
    } finally {
      setEnviando(false);
    }
  }

  if (verificando) {
    return (
      <main className="pagina pagina-estreita">
        <Carregando mensagem="Verificando o link…" />
      </main>
    );
  }

  if (!linkValido) {
    return (
      <main className="pagina pagina-estreita">
        <MarcaPublica />
      <header className="cabecalho">
          <h1>Link inválido</h1>
        </header>
        <div className="painel">
          <Aviso tipo="erro">{erroLink}</Aviso>
          <p className="rodape-form">
            <Link to="/recuperar-senha">Solicitar um novo link</Link>
          </p>
        </div>
      </main>
    );
  }

  if (concluido) {
    return (
      <main className="pagina pagina-estreita">
        <header className="cabecalho">
          <h1>Senha redefinida</h1>
        </header>
        <div className="painel">
          <Aviso tipo="sucesso">Sua senha foi alterada. Entre com a nova senha.</Aviso>
          <p className="rodape-form">
            <Link to="/entrar">Ir para o login</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="pagina pagina-estreita">
      <header className="cabecalho">
        <h1>Nova senha</h1>
        <p>Escolha uma senha com pelo menos {SENHA_MINIMA} caracteres.</p>
      </header>

      <form className="painel" onSubmit={aoEnviar} noValidate>
        <Aviso tipo="erro">{erro}</Aviso>

        <Campo
          id="senha"
          rotulo="Nova senha"
          type="password"
          name="senha"
          autoComplete="new-password"
          autoFocus
          required
          minLength={SENHA_MINIMA}
          value={senha}
          erro={campos.senha}
          dica={`Mínimo de ${SENHA_MINIMA} caracteres.`}
          onChange={(e) => setSenha(e.target.value)}
        />

        <Campo
          id="confirmacao"
          rotulo="Repita a nova senha"
          type="password"
          name="confirmacao"
          autoComplete="new-password"
          required
          value={confirmacao}
          erro={campos.confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />

        <button className="botao botao-bloco" type="submit" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      </form>
    </main>
  );
}
