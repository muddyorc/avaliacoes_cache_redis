// Rede de segurança para falhas de renderização.
//
// Sem isso, qualquer exceção durante a renderização desmonta a árvore inteira e o
// usuário fica com a **página em branco** — sem mensagem, sem menu, sem saber se o
// problema foi dele, da rede ou do sistema.
//
// O caso mais comum não é um defeito de lógica: as telas pesadas (dashboard, gráficos)
// entram por importação sob demanda, e esse pedaço pode não chegar — conexão instável,
// servidor reiniciado ou uma versão nova publicada enquanto a aba estava aberta. Aí o
// que resolve é recarregar, e é isso que a tela passa a oferecer.
//
// Precisa ser classe: capturar erro de renderização é o único caso em que o React ainda
// não oferece equivalente em função.
import { Component } from 'react';

const MODULO_NAO_CARREGOU = /dynamically imported module|Importing a module script failed|Loading chunk/i;

export class LimiteDeErro extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro) {
    // Sem serviço de telemetria no projeto; o console é onde o erro fica consultável.
    console.error('[tela] falha ao renderizar:', erro);
  }

  componentDidUpdate(propsAnteriores) {
    // Trocar de tela limpa o erro: o que quebrou foi a tela anterior.
    if (this.state.erro && propsAnteriores.chave !== this.props.chave) {
      this.setState({ erro: null });
    }
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    const desatualizada = MODULO_NAO_CARREGOU.test(erro.message ?? '');
    return (
      <main className="pagina">
        <section className="cartao">
          <h1>Não foi possível abrir esta tela</h1>
          <p className="texto-suave">
            {desatualizada
              ? 'Parte da página não chegou a carregar. Isso costuma acontecer quando o sistema é atualizado com a aba aberta — recarregar resolve.'
              : 'Algo falhou ao montar esta tela. Seus dados não foram perdidos: nada é gravado por esta página sem que você peça.'}
          </p>
          <div className="barra-acoes">
            <button className="botao" type="button" onClick={() => window.location.reload()}>
              Recarregar a página
            </button>
            <button className="botao botao-secundario" type="button" onClick={() => window.history.back()}>
              Voltar
            </button>
          </div>
          {erro.message && (
            <p className="texto-suave espaco-acima-pequeno">
              <small>Detalhe técnico: {erro.message}</small>
            </p>
          )}
        </section>
      </main>
    );
  }
}
