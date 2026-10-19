// Formulário de criação e edição de questão (UC05).
//
// Objetiva: o professor escolhe entre **uma** correta e **várias** (P-26). Com várias, o
// estudante marca todas que julga verdadeiras e a nota é parcial.
// Discursiva: resposta esperada opcional (P-03 revista) e critérios opcionais.
// As regras são validadas de novo no backend — aqui só evitam idas e voltas.
import { useState } from 'react';
import { Campo } from './Campo.jsx';
import { Aviso } from './Aviso.jsx';

const MIN_ALTERNATIVAS = 2;
const MAX_ALTERNATIVAS = 10;
const LETRAS = 'ABCDEFGHIJ';

// Cada alternativa carrega uma identidade própria, usada como `key` da lista.
//
// Sem isso, a chave seria a posição — e, ao remover uma alternativa do meio, o React
// reaproveitaria o campo de texto da posição seguinte: o cursor e o foco saltam para a
// linha errada no meio da digitação. O identificador existe só enquanto o formulário
// está aberto e não é enviado à API.
let proximaChave = 0;
const comChave = (alternativa) => ({ ...alternativa, chave: (proximaChave += 1) });

const alternativasIniciais = () =>
  [
    { texto: '', correta: true },
    { texto: '', correta: false },
    { texto: '', correta: false },
    { texto: '', correta: false },
  ].map(comChave);

// `titulo` e `subtitulo` permitem reutilizar o formulário dentro do editor de avaliação,
// onde a questão criada vai para o banco e também para a prova (P-21).
// `dentroDaPagina` faz o formulário se comportar como um bloco de outra tela, em vez de
// desenhar a própria página — é assim que o editor da prova o usa, sem <main> aninhado.
export function FormularioQuestao({ questao, temas, aoSalvar, aoCancelar, titulo, subtitulo, dentroDaPagina = false }) {
  const editando = Boolean(questao);

  const [tipo, setTipo] = useState(questao?.tipo ?? 'OBJETIVA');
  const [enunciado, setEnunciado] = useState(questao?.enunciado ?? '');
  const [tema, setTema] = useState(questao?.tema ?? '');
  const [pontuacao, setPontuacao] = useState(String(questao?.pontuacaoPadrao ?? '1'));
  const [alternativas, setAlternativas] = useState(
    questao?.alternativas?.length
      ? questao.alternativas.map((a) => comChave({ texto: a.texto, correta: a.correta }))
      : alternativasIniciais(),
  );
  const [multiplasCorretas, setMultiplasCorretas] = useState(questao?.multiplasCorretas ?? false);
  const [respostaEsperada, setRespostaEsperada] = useState(questao?.respostaEsperada ?? '');
  const [criterios, setCriterios] = useState(questao?.criteriosCorrecao ?? '');

  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [enviando, setEnviando] = useState(false);

  function alterarTexto(indice, texto) {
    setAlternativas((lista) => lista.map((a, i) => (i === indice ? { ...a, texto } : a)));
  }

  // Com resposta única, marcar uma desmarca as demais. Com várias, cada uma alterna
  // sozinha — é a diferença entre o rádio e a caixa de seleção, e a função acompanha.
  function marcarCorreta(indice) {
    setAlternativas((lista) =>
      multiplasCorretas
        ? lista.map((a, i) => (i === indice ? { ...a, correta: !a.correta } : a))
        : lista.map((a, i) => ({ ...a, correta: i === indice })),
    );
  }

  // Ao voltar para resposta única, sobra no máximo uma correta: a primeira marcada. Sem
  // isso o formulário ficaria num estado que o servidor recusa, e a pessoa descobriria
  // só ao salvar.
  function alternarTipoDeResposta(varias) {
    setMultiplasCorretas(varias);
    if (!varias) {
      setAlternativas((lista) => {
        const primeira = lista.findIndex((a) => a.correta);
        const escolhida = primeira === -1 ? 0 : primeira;
        return lista.map((a, i) => ({ ...a, correta: i === escolhida }));
      });
    }
  }

  function adicionar() {
    setAlternativas((lista) => [...lista, comChave({ texto: '', correta: false })]);
  }

  function remover(indice) {
    setAlternativas((lista) => {
      const restantes = lista.filter((_, i) => i !== indice);
      // Se a única correta foi removida, a primeira assume — nunca fica sem gabarito na
      // tela, nem com várias corretas nem com uma só.
      if (!restantes.some((a) => a.correta)) restantes[0] = { ...restantes[0], correta: true };
      return restantes;
    });
  }

  async function enviar(evento) {
    evento.preventDefault();
    setErro('');
    setCampos({});
    setEnviando(true);
    try {
      await aoSalvar({
        tipo,
        enunciado,
        tema: tema.trim() || null,
        // Vírgula decimal é o que o professor brasileiro digita.
        pontuacaoPadrao: pontuacao.replace(',', '.'),
        alternativas:
          tipo === 'OBJETIVA' ? alternativas.map(({ texto, correta }) => ({ texto, correta })) : [],
        multiplasCorretas: tipo === 'OBJETIVA' ? multiplasCorretas : false,
        respostaEsperada: tipo === 'DISCURSIVA' ? respostaEsperada : null,
        criteriosCorrecao: tipo === 'DISCURSIVA' ? criterios : null,
      });
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
    } finally {
      setEnviando(false);
    }
  }

  // Erros de uma alternativa específica chegam como "alternativas.2.texto".
  const erroDaAlternativa = (i) => campos[`alternativas.${i}.texto`];

  const Moldura = dentroDaPagina ? 'div' : 'main';

  return (
    <Moldura className={dentroDaPagina ? 'conteudo-central' : 'pagina'}>
      <header className="cabecalho">
        <h1>{titulo ?? (editando ? 'Editar questão' : 'Nova questão')}</h1>
        {subtitulo && <p>{subtitulo}</p>}
        <p>O gabarito fica visível apenas para você; estudantes nunca o recebem.</p>
      </header>

      <form className="painel" onSubmit={enviar} noValidate>
        <Aviso tipo="erro">{erro}</Aviso>

        <fieldset className="grupo-opcoes">
          <legend>Tipo da questão</legend>
          <label>
            <input
              type="radio"
              name="tipo"
              value="OBJETIVA"
              checked={tipo === 'OBJETIVA'}
              onChange={() => setTipo('OBJETIVA')}
            />{' '}
            Objetiva
          </label>
          <label>
            <input
              type="radio"
              name="tipo"
              value="DISCURSIVA"
              checked={tipo === 'DISCURSIVA'}
              onChange={() => setTipo('DISCURSIVA')}
            />{' '}
            Discursiva
          </label>
          {campos.tipo && <p className="campo-erro">{campos.tipo}</p>}
        </fieldset>

        <Campo
          id="enunciado"
          rotulo="Enunciado"
          multilinha
          rows={5}
          required
          autoFocus
          value={enunciado}
          erro={campos.enunciado}
          onChange={(e) => setEnunciado(e.target.value)}
        />

        <div className="linha-campos">
          <Campo
            id="tema"
            rotulo="Tema (opcional)"
            list="temas-existentes"
            autoComplete="off"
            value={tema}
            erro={campos.tema}
            dica="Use o mesmo tema para agrupar questões relacionadas."
            onChange={(e) => setTema(e.target.value)}
          />
          <datalist id="temas-existentes">
            {temas.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          <Campo
            id="pontuacao"
            rotulo="Pontuação padrão"
            inputMode="decimal"
            required
            value={pontuacao}
            erro={campos.pontuacaoPadrao}
            dica="Pode ser ajustada em cada avaliação."
            onChange={(e) => setPontuacao(e.target.value)}
          />
        </div>

        {tipo === 'OBJETIVA' ? (
          <fieldset className="grupo-alternativas" aria-describedby="alternativas-dica">
            <legend>Alternativas</legend>
            <p className="campo-dica" id="alternativas-dica">
              {multiplasCorretas
                ? 'Marque todas as alternativas corretas. O estudante marca as que julgar verdadeiras, e a nota é proporcional ao que acertar, descontando o que marcar errado.'
                : 'Marque a alternativa correta. Deve haver exatamente uma.'}
            </p>

            <div className="campo campo-marcador">
              <label>
                <input
                  type="checkbox"
                  checked={multiplasCorretas}
                  onChange={(e) => alternarTipoDeResposta(e.target.checked)}
                />{' '}
                Mais de uma alternativa correta
              </label>
              <p className="campo-dica">
                Para questão de Verdadeiro ou Falso em que várias afirmativas estão certas.
              </p>
            </div>

            {alternativas.map((alternativa, i) => (
              <div
                className={`alternativa${alternativa.correta ? ' alternativa-correta' : ''}`}
                key={alternativa.chave}
              >
                <label className="alternativa-marcador">
                  <input
                    type={multiplasCorretas ? 'checkbox' : 'radio'}
                    name={multiplasCorretas ? `correta-${i}` : 'correta'}
                    checked={alternativa.correta}
                    onChange={() => marcarCorreta(i)}
                    aria-label={`Alternativa ${LETRAS[i]} é correta`}
                  />
                  <span aria-hidden="true">{LETRAS[i]}</span>
                </label>
                <div className="alternativa-texto">
                  <input
                    aria-label={`Texto da alternativa ${LETRAS[i]}`}
                    aria-invalid={erroDaAlternativa(i) ? 'true' : undefined}
                    value={alternativa.texto}
                    onChange={(e) => alterarTexto(i, e.target.value)}
                  />
                  {erroDaAlternativa(i) && <p className="campo-erro">{erroDaAlternativa(i)}</p>}
                </div>
                <button
                  className="botao botao-secundario botao-pequeno"
                  type="button"
                  onClick={() => remover(i)}
                  disabled={alternativas.length <= MIN_ALTERNATIVAS}
                  aria-label={`Remover alternativa ${LETRAS[i]}`}
                >
                  Remover
                </button>
              </div>
            ))}

            {campos.alternativas && <p className="campo-erro">{campos.alternativas}</p>}

            <div className="barra-acoes">
              <button
                className="botao botao-secundario botao-pequeno"
                type="button"
                onClick={adicionar}
                disabled={alternativas.length >= MAX_ALTERNATIVAS}
              >
                Adicionar alternativa
              </button>
              {/* Havia aqui um atalho "Usar Verdadeiro / Falso", que trocava as
                  alternativas por duas, "Verdadeiro" e "Falso". Removido a pedido do
                  orientador em 16/10/2026: V ou F já é uma objetiva com duas
                  alternativas, e o professor as escreve como escreveria quaisquer
                  outras. O atalho sugeria um TIPO de questão que o sistema não tem — e
                  ainda apagava o que estivesse escrito, sem avisar. */}
            </div>
          </fieldset>
        ) : (
          <>
            <Campo
              id="respostaEsperada"
              rotulo="Resposta esperada (opcional)"
              multilinha
              rows={4}
              value={respostaEsperada}
              erro={campos.respostaEsperada}
              dica="Referência para a correção; nunca é mostrada ao estudante. Sem ela, a correção assistida avalia pelo enunciado e pelo tema — informar uma referência deixa a sugestão mais precisa."
              onChange={(e) => setRespostaEsperada(e.target.value)}
            />
            <Campo
              id="criterios"
              rotulo="Critérios de correção (opcional)"
              multilinha
              rows={3}
              value={criterios}
              erro={campos.criteriosCorrecao}
              dica="Ex.: pontos que a resposta precisa conter e quanto vale cada um."
              onChange={(e) => setCriterios(e.target.value)}
            />
          </>
        )}

        <div className="barra-acoes">
          <button className="botao" type="submit" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar questão'}
          </button>
          <button className="botao botao-secundario" type="button" onClick={aoCancelar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </Moldura>
  );
}
