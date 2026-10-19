// RF11 / UC11 — a correção assistida por IA, na tela em que o professor abre a prova.
//
// Fluxo decidido pelo autor em 06/10/2026: ao abrir a prova, o sistema já analisa as
// discursivas e apresenta a nota sugerida. O professor **aprova** — e a nota é
// registrada — ou **recusa**, e aí o campo de nota abre para correção manual.
//
// A regra que isso não pode quebrar é a RN04: a nota nunca é atribuída sozinha. Entre a
// sugestão e a nota existe sempre um clique do professor, e a tela diz isso.
//
// Enquanto a questão está aguardando decisão, o campo de nota fica desabilitado — não
// para tirar poder do professor, mas para deixar claro que há uma decisão pendente ali.
// Recusar devolve o campo imediatamente.
import { useState } from 'react';
import { api } from '../api/client.js';
import { formatarPontos } from '../utils/datas.js';

export function SugestaoIA({ avaliacaoId, tentativaId, questao, analisando, aoAprovar, aoRecusar, recusada }) {
  const [sugestao, setSugestao] = useState(questao.sugestaoIA ?? null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aprovada, setAprovada] = useState(false);

  const semResposta = !questao.texto?.trim();
  const jaCorrigida = questao.notaFinal !== null && questao.notaFinal !== undefined;

  async function gerar() {
    setCarregando(true);
    setErro('');
    try {
      const r = await api(
        `/correcao/${avaliacaoId}/tentativas/${tentativaId}/questoes/${questao.questaoId}/sugestao`,
        { metodo: 'POST' },
      );
      setSugestao(r.sugestao);
    } catch (falha) {
      // UC11 A5: serviço indisponível não trava a correção — o professor segue à mão.
      setErro(falha.message);
      aoRecusar();
    } finally {
      setCarregando(false);
    }
  }

  // UC11 A6: sem resposta não há o que analisar.
  if (semResposta) {
    return (
      <p className="texto-suave sem-margem espaco-acima-pequeno">
        Sem resposta registrada: não há conteúdo para analisar. Atribua a nota diretamente.
      </p>
    );
  }

  if (jaCorrigida && !sugestao) return null;

  if (analisando && !sugestao) {
    return (
      <p className="texto-suave sem-margem espaco-acima-pequeno" role="status">
        Analisando a resposta…
      </p>
    );
  }

  return (
    <div className="bloco-ia espaco-acima-pequeno">
      {erro && (
        <p className="campo-erro sem-margem">
          {erro} Corrija esta questão manualmente.
        </p>
      )}

      {!sugestao && !erro && (
        <div className="bloco-ia-topo">
          <button className="botao botao-secundario botao-pequeno" type="button" onClick={gerar} disabled={carregando}>
            {carregando ? 'Analisando…' : 'Analisar com IA'}
          </button>
        </div>
      )}

      {sugestao && (
        <div className={`cartao-sugestao${aprovada ? ' cartao-sugestao-aprovada' : ''}`}>
          <p className="sem-margem">
            <strong>Nota sugerida: {formatarPontos(sugestao.nota)}</strong>
            <span className="texto-suave"> de {formatarPontos(questao.pontuacao)}</span>
          </p>
          <p className="quebra">{sugestao.justificativa}</p>

          {aprovada ? (
            <p className="sem-margem texto-suave">
              Nota aprovada e preenchida abaixo. Salve a correção para registrá-la.
            </p>
          ) : recusada ? (
            <div className="bloco-ia-topo">
              <p className="sem-margem texto-suave">Sugestão recusada. Atribua a nota no campo abaixo.</p>
              {/* Uma segunda análise é útil quando a primeira veio ruim — e quando a
                  anterior foi gerada em modo simulado, antes de a chave existir. Cada
                  análise nova consome uma chamada, por isso é sempre explícita. */}
              <button className="botao botao-secundario botao-pequeno" type="button" onClick={gerar} disabled={carregando}>
                {carregando ? 'Analisando…' : 'Analisar de novo'}
              </button>
            </div>
          ) : (
            <div className="bloco-ia-topo">
              <button
                className="botao botao-pequeno"
                type="button"
                onClick={() => {
                  // A nota vai para o campo; registrar continua dependendo de salvar.
                  aoAprovar(String(sugestao.nota).replace('.', ','), sugestao.justificativa);
                  setAprovada(true);
                }}
              >
                Aprovar nota
              </button>
              <button className="botao botao-secundario botao-pequeno" type="button" onClick={aoRecusar}>
                Recusar e corrigir manualmente
              </button>
              <button className="botao botao-secundario botao-pequeno" type="button" onClick={gerar} disabled={carregando}>
                {carregando ? 'Analisando…' : 'Analisar de novo'}
              </button>
            </div>
          )}

          <p className="sem-margem texto-suave">
            {sugestao.simulada
              ? 'Sugestão simulada — nenhum serviço de IA foi consultado.'
              : `Sugestão gerada por ${sugestao.modelo}. A nota final é sua.`}
          </p>
        </div>
      )}
    </div>
  );
}
