// UC01 A2 — pedido de recuperação de senha (RF01, P-11).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { MarcaPublica } from '../componentes/MarcaPublica.jsx';

export function RecuperarSenha() {
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(evento) {
    evento.preventDefault();
    setErro('');
    setCampos({});
    setEnviando(true);
    try {
      const dados = await api('/auth/recuperacao', { metodo: 'POST', corpo: { email } });
      // A API responde a mesma coisa exista ou não a conta: a tela também não pode
      // deixar escapar a diferença.
      setMensagem(dados.mensagem);
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
    } finally {
      setEnviando(false);
    }
  }

  if (mensagem) {
    return (
      <main className="pagina pagina-estreita">
        <MarcaPublica />
      <header className="cabecalho">
          <h1>Verifique seu e-mail</h1>
        </header>
        <div className="painel">
          <Aviso tipo="sucesso">{mensagem}</Aviso>
          <p className="texto-suave">
            O link vale por 1 hora e pode ser usado uma única vez. Se não encontrar a mensagem,
            confira a caixa de spam.
          </p>
          <p className="rodape-form">
            <Link to="/entrar">Voltar para o login</Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="pagina pagina-estreita">
      <header className="cabecalho">
        <h1>Recuperar senha</h1>
        <p>Informe o e-mail da sua conta e enviaremos um link para cadastrar uma nova senha.</p>
      </header>

      <form className="painel" onSubmit={aoEnviar} noValidate>
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

        <button className="botao botao-bloco" type="submit" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar link de recuperação'}
        </button>

        <p className="rodape-form">
          <Link to="/entrar">Voltar para o login</Link>
        </p>
      </form>
    </main>
  );
}
