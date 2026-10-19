// Uma questão como o estudante a responde: alternativas (objetiva) ou texto (discursiva).
//
// Usado pelo modo de teste do professor (P-20) e pela realização da avaliação. Nunca
// recebe o gabarito: só enunciado e alternativas.
//
// P-26: quando a questão aceita mais de uma correta, o rádio vira caixa de seleção. Não é
// só estética — rádio comunica “escolha uma”, e o estudante precisa saber que pode (e
// deve) marcar quantas julgar verdadeiras.
const LETRAS = 'ABCDEFGHIJ';

function formatarPontos(valor) {
  const texto = Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return `${texto} ${Number(valor) === 1 ? 'ponto' : 'pontos'}`;
}

export function QuestaoResposta({ questao, numero, resposta, aoResponder, desabilitado = false, travada = false }) {
  const idBase = `questao-${questao.questaoId}`;

  return (
    <fieldset className="questao-prova" disabled={desabilitado || travada}>
      <legend className="questao-prova-cabecalho">
        <span>Questão {numero}</span>
        <span className="texto-suave">{formatarPontos(questao.pontuacao)}</span>
      </legend>
      {/* Dizer POR QUE está fechada, e não só fechar: um campo que não responde ao
          clique, sem explicação, parece defeito do sistema. */}
      {travada && (
        <p className="texto-suave questao-prova-travada">
          Você já havia respondido esta questão antes de o professor devolver a prova. A resposta foi mantida e não
          pode ser alterada.
        </p>
      )}
      <p className="questao-prova-enunciado">{questao.enunciado}</p>

      {questao.tipo === 'OBJETIVA' ? (
        <div className="questao-prova-alternativas">
          {questao.marcarVarias && (
            <p className="campo-dica sem-margem">
              Marque <strong>todas</strong> as alternativas que você considera corretas.
            </p>
          )}
          {questao.alternativas.map((alternativa, i) => {
            const id = `${idBase}-alt-${alternativa.id}`;
            const marcadas = resposta?.alternativaIds ?? [];
            const marcada = questao.marcarVarias
              ? marcadas.includes(alternativa.id)
              : resposta?.alternativaId === alternativa.id;
            const alternar = () =>
              questao.marcarVarias
                ? aoResponder({
                    alternativaIds: marcada
                      ? marcadas.filter((x) => x !== alternativa.id)
                      : [...marcadas, alternativa.id],
                  })
                : aoResponder({ alternativaId: alternativa.id });
            return (
              <label key={alternativa.id} htmlFor={id} className={`opcao-prova${marcada ? ' opcao-prova-marcada' : ''}`}>
                <input
                  id={id}
                  type={questao.marcarVarias ? 'checkbox' : 'radio'}
                  name={questao.marcarVarias ? id : idBase}
                  checked={marcada}
                  onChange={alternar}
                />
                <span className="opcao-prova-letra" aria-hidden="true">
                  {LETRAS[i]}
                </span>
                <span>{alternativa.texto}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="campo">
          <label htmlFor={`${idBase}-texto`}>Sua resposta</label>
          <textarea
            id={`${idBase}-texto`}
            rows={6}
            value={resposta?.texto ?? ''}
            onChange={(e) => aoResponder({ texto: e.target.value })}
          />
        </div>
      )}
    </fieldset>
  );
}
