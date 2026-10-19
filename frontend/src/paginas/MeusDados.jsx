// UC03 — cada usuário edita os próprios dados e troca a própria senha (RF02).
// Perfil e situação não aparecem como editáveis: são atribuição do administrador (P-17).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { caminhoInicial, useAuth } from '../auth/ContextoAuth.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { api } from '../api/client.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';

const SENHA_MINIMA = 8;

const ROTULO_PERFIL = {
  ADMINISTRADOR: 'Administrador',
  PROFESSOR: 'Professor',
  ESTUDANTE: 'Estudante',
};

export function MeusDados() {
  const { usuario, recarregarUsuario } = useAuth();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erroDados, setErroDados] = useState('');
  const [camposDados, setCamposDados] = useState({});
  const [okDados, setOkDados] = useState('');
  const [salvando, setSalvando] = useState(false);

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erroSenha, setErroSenha] = useState('');
  const [camposSenha, setCamposSenha] = useState({});
  const [okSenha, setOkSenha] = useState('');
  const [trocando, setTrocando] = useState(false);

  useEffect(() => {
    let ativo = true;
    api('/usuarios/eu')
      .then((dados) => {
        if (!ativo) return;
        setNome(dados.usuario.nome);
        setEmail(dados.usuario.email);
      })
      .catch((falha) => ativo && setErroDados(falha.message))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, []);

  async function salvarDados(evento) {
    evento.preventDefault();
    setErroDados('');
    setCamposDados({});
    setOkDados('');
    setSalvando(true);
    try {
      await api('/usuarios/eu', { metodo: 'PATCH', corpo: { nome, email } });
      setOkDados('Dados atualizados.');
      // O cabeçalho mostra o nome: recarrega a sessão para refletir a mudança.
      await recarregarUsuario();
    } catch (falha) {
      setErroDados(falha.message);
      setCamposDados(falha.campos || {});
    } finally {
      setSalvando(false);
    }
  }

  async function trocarSenha(evento) {
    evento.preventDefault();
    setErroSenha('');
    setCamposSenha({});
    setOkSenha('');

    if (novaSenha !== confirmacao) {
      setCamposSenha({ confirmacao: 'As senhas não coincidem.' });
      return;
    }

    setTrocando(true);
    try {
      await api('/usuarios/eu/senha', { metodo: 'PUT', corpo: { senhaAtual, novaSenha } });
      setOkSenha('Senha alterada.');
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmacao('');
    } catch (falha) {
      setErroSenha(falha.message);
      setCamposSenha(falha.campos || {});
    } finally {
      setTrocando(false);
    }
  }

  return (
    // Dentro do Layout, como as demais telas do menu. Serve aos três perfis, e o Layout
    // monta a navegação a partir do perfil de quem está logado — então cada um vê o seu
    // próprio menu, sem a tela precisar saber disso.
    <Layout titulo="Meus dados">
      <div className="conteudo-central">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>Meus dados</h1>
          <p>
            Perfil: <strong>{ROTULO_PERFIL[usuario.perfil]}</strong> — definido pelo administrador
          </p>
        </div>
        {/* O menu lateral já leva ao início; este botão nomeia o destino em vez de dizer
            só "Voltar", que não diz para onde. */}
        <Link className="botao botao-secundario" to={caminhoInicial(usuario)}>
          Ir para o início
        </Link>
      </header>

      {carregando ? (
        <Carregando />
      ) : (
        <>
          <section className="painel">
            <h2>Dados pessoais</h2>
            <form onSubmit={salvarDados} noValidate>
              <Aviso tipo="erro">{erroDados}</Aviso>
              <Aviso tipo="sucesso">{okDados}</Aviso>

              <Campo
                id="nome"
                rotulo="Nome completo"
                name="nome"
                autoComplete="name"
                required
                value={nome}
                erro={camposDados.nome}
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
                erro={camposDados.email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <button className="botao" type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </form>
          </section>

          <section className="painel espaco-acima">
            <h2>Trocar senha</h2>
            <form onSubmit={trocarSenha} noValidate>
              <Aviso tipo="erro">{erroSenha}</Aviso>
              <Aviso tipo="sucesso">{okSenha}</Aviso>

              <Campo
                id="senhaAtual"
                rotulo="Senha atual"
                type="password"
                name="senhaAtual"
                autoComplete="current-password"
                required
                value={senhaAtual}
                erro={camposSenha.senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
              />
              <Campo
                id="novaSenha"
                rotulo="Nova senha"
                type="password"
                name="novaSenha"
                autoComplete="new-password"
                required
                minLength={SENHA_MINIMA}
                value={novaSenha}
                erro={camposSenha.novaSenha}
                dica={`Mínimo de ${SENHA_MINIMA} caracteres.`}
                onChange={(e) => setNovaSenha(e.target.value)}
              />
              <Campo
                id="confirmacaoSenha"
                rotulo="Repita a nova senha"
                type="password"
                name="confirmacaoSenha"
                autoComplete="new-password"
                required
                value={confirmacao}
                erro={camposSenha.confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
              />

              <button className="botao" type="submit" disabled={trocando}>
                {trocando ? 'Alterando…' : 'Trocar senha'}
              </button>
            </form>
          </section>
        </>
      )}
      </div>
    </Layout>
  );
}
