// Formulário de cadastro e edição de usuário pelo administrador (UC02).
//
// Na edição a senha não aparece: o administrador não define nem vê a senha de outra
// pessoa. Quem esqueceu a senha usa "Esqueci minha senha" na tela de login.
import { useState } from 'react';
import { useAuth } from '../auth/ContextoAuth.jsx';
import { Campo } from './Campo.jsx';
import { Aviso } from './Aviso.jsx';

const SENHA_MINIMA = 8;

export function FormularioUsuario({ usuario, perfis, aoSalvar, aoCancelar }) {
  const { usuario: eu } = useAuth();
  const editando = Boolean(usuario);
  const souEu = editando && usuario.id === eu.id;

  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [perfil, setPerfil] = useState(usuario?.perfil ?? 'ESTUDANTE');
  const [situacao, setSituacao] = useState(usuario?.situacao ?? 'ATIVO');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    setCampos({});
    setEnviando(true);
    try {
      const valores = editando ? { nome, email } : { nome, email, senha, perfil, situacao };
      // O próprio perfil não pode ser alterado por quem está editando a si mesmo, então
      // o campo nem é enviado nesse caso.
      if (editando && !souEu) valores.perfil = perfil;
      await aoSalvar(valores, usuario?.id);
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="pagina pagina-estreita">
      <header className="cabecalho">
        <h1>{editando ? 'Editar usuário' : 'Cadastrar usuário'}</h1>
        {editando && <p className="texto-suave">{usuario.email}</p>}
      </header>

      <form className="painel" onSubmit={enviar} noValidate>
        <Aviso tipo="erro">{erro}</Aviso>

        <Campo
          id="nome"
          rotulo="Nome completo"
          name="nome"
          autoComplete="off"
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
          autoComplete="off"
          required
          value={email}
          erro={campos.email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="campo">
          <label htmlFor="perfil">Perfil</label>
          <select
            id="perfil"
            value={perfil}
            disabled={souEu}
            aria-describedby={souEu ? 'perfil-dica' : undefined}
            onChange={(e) => setPerfil(e.target.value)}
          >
            {perfis.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.rotulo}
              </option>
            ))}
          </select>
          {souEu && (
            <p className="campo-dica" id="perfil-dica">
              Você não pode alterar o seu próprio perfil.
            </p>
          )}
          {campos.perfil && <p className="campo-erro">{campos.perfil}</p>}
        </div>

        {!editando && (
          <>
            <div className="campo">
              <label htmlFor="situacao">Situação inicial</label>
              <select id="situacao" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
                <option value="ATIVO">Ativo</option>
                <option value="INATIVO">Inativo</option>
              </select>
            </div>

            <Campo
              id="senha"
              rotulo="Senha inicial"
              type="password"
              name="senha-inicial"
              autoComplete="new-password"
              required
              minLength={SENHA_MINIMA}
              value={senha}
              erro={campos.senha}
              dica={`Mínimo de ${SENHA_MINIMA} caracteres. Informe-a ao usuário, que poderá trocá-la em "Meus dados".`}
              onChange={(e) => setSenha(e.target.value)}
            />
          </>
        )}

        <div className="barra-acoes">
          <button className="botao" type="submit" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button className="botao botao-secundario" type="button" onClick={aoCancelar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </main>
  );
}
