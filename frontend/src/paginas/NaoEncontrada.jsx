import { Link } from 'react-router-dom';
import { caminhoInicial, useAuth } from '../auth/ContextoAuth.jsx';

export function NaoEncontrada() {
  const { usuario } = useAuth();
  const destino = usuario ? caminhoInicial(usuario) : '/entrar';

  return (
    <main className="pagina pagina-estreita">
      <header className="cabecalho">
        <h1>Página não encontrada</h1>
        <p>O endereço acessado não existe neste sistema.</p>
      </header>
      <div className="painel">
        <p className="rodape-form">
          <Link to={destino}>{usuario ? 'Voltar para a minha área' : 'Ir para o login'}</Link>
        </p>
      </div>
    </main>
  );
}
