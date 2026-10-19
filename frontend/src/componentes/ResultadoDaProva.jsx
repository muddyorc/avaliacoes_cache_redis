// RF13 (estendido) — o resultado da prova como o estudante o vê.
//
// A ordem da tela é a que o autor pediu: primeiro a nota, depois a correção questão a
// questão (quando o professor libera o gabarito) e, embaixo, os indicadores da turma.
//
// A tela não decide nada: o servidor só envia o que foi liberado, e os dados da turma
// chegam sem nome e sem nota de terceiros. Aqui só resta apresentar.
import { Suspense, lazy, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Aviso } from './Aviso.jsx';
import { Carregando } from './Carregando.jsx';
import { formatarPontos } from '../utils/datas.js';

// O gráfico traz junto a biblioteca de visualização, que pesa mais do que a tela
// inteira. Como ele só aparece quando o professor libera a comparação com a turma,
// vem sob demanda — mesma razão do DT58 no painel do professor.
const GraficoBarras = lazy(() =>
  import('./GraficoBarras.jsx').then((modulo) => ({ default: modulo.GraficoBarras })),
);

// A tabela logo abaixo de cada gráfico já carrega o mesmo conteúdo, então o espaço
// vazio durante o carregamento não esconde informação de ninguém.
function Grafico(props) {
  return (
    <Suspense fallback={<div className="grafico" aria-hidden="true" />}>
      <GraficoBarras {...props} />
    </Suspense>
  );
}

const LETRAS = 'ABCDEFGHIJ';

function Nota({ nota }) {
  return (
    <section className="cartao">
      <h2>Sua nota</h2>
      <div className="placar">
        <div>
          <p className="placar-numero">{formatarPontos(nota.pontos)}</p>
          <p className="texto-suave sem-margem">de {formatarPontos(nota.pontuacaoMaxima)}</p>
        </div>
        {nota.percentual !== null && (
          <div>
            <p className="placar-numero">{nota.percentual}%</p>
            <p className="texto-suave sem-margem">de aproveitamento</p>
          </div>
        )}
      </div>
    </section>
  );
}

function QuestaoCorrigida({ questao }) {
  const objetiva = questao.tipo === 'OBJETIVA';
  // Acerto parcial só existe na questão de múltipla escolha (P-26). Chamar de "errou"
  // quem tirou metade dos pontos seria desmentir a própria nota exibida ao lado.
  const nota = Number(questao.notaObtida ?? 0);
  const parcial = questao.notaObtida !== null && nota > 0 && nota < Number(questao.pontuacao);

  const situacao = !questao.respondida
    ? { rotulo: 'Sem resposta', classe: 'etiqueta-alerta' }
    : questao.correta === true
      ? { rotulo: 'Você acertou', classe: 'etiqueta-sucesso' }
      : parcial
        ? { rotulo: 'Acertou em parte', classe: 'etiqueta-neutra' }
        : questao.correta === false
          ? { rotulo: 'Você errou', classe: 'etiqueta-alerta' }
          : { rotulo: 'Corrigida pelo professor', classe: 'etiqueta-neutra' };

  return (
    <li>
      <article className="questao-cartao">
        <div className="questao-cartao-topo">
          <span className="questao-cartao-numero">{questao.ordem}</span>
          <span className={`etiqueta ${situacao.classe}`}>{situacao.rotulo}</span>
          <span className="texto-suave">
            {questao.notaObtida === null ? '—' : formatarPontos(questao.notaObtida)} de{' '}
            {formatarPontos(questao.pontuacao)}
          </span>
        </div>

        <p className="questao-cartao-enunciado">{questao.enunciado}</p>

        {objetiva ? (
          <ul className="alternativas-editor alternativas-gabarito">
            {questao.alternativas.map((alternativa, indice) => {
              // P-26: numa questão de múltipla escolha a marcação é um conjunto.
              const marcada =
                alternativa.id === questao.alternativaMarcada ||
                (questao.alternativasMarcadas ?? []).includes(alternativa.id);
              const classes = [alternativa.correta ? 'correta' : '', marcada ? 'marcada' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <li key={alternativa.id} className={classes}>
                  <span className="alternativa-letra" aria-hidden="true">
                    {LETRAS[indice] ?? indice + 1}
                  </span>
                  <span className="quebra">
                    {alternativa.texto}
                    {alternativa.correta && <strong> · resposta correta</strong>}
                    {marcada && <em> · você marcou esta</em>}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="comparacao-discursiva">
            <div>
              <h3>Sua resposta</h3>
              <p className="quebra">{questao.minhaResposta || 'Você não respondeu esta questão.'}</p>
            </div>
            {questao.respostaEsperada && (
              <div>
                <h3>O que era esperado</h3>
                <p className="quebra">{questao.respostaEsperada}</p>
              </div>
            )}
          </div>
        )}

        {questao.feedback && (
          <p className="item-lista-apoio">
            <strong>Comentário do professor:</strong> {questao.feedback}
          </p>
        )}
      </article>
    </li>
  );
}

function Comparacao({ comparacao, nota }) {
  if (!comparacao) return null;

  // A comparação é sempre com a turma em que a prova foi feita — o servidor já recortou
  // assim. A tela não diz de quantas provas se trata nem nomeia a turma: o estudante
  // compara o desempenho, e contar quem fez não é assunto dele.
  if (!comparacao.suficiente) {
    return (
      <section className="cartao">
        <h2>Comparação com a turma</h2>
        <p className="texto-suave sem-margem">
          O professor liberou a comparação, mas ela só aparece quando a turma tiver provas corrigidas suficientes —
          com poucas, seria possível deduzir a nota dos colegas.
        </p>
      </section>
    );
  }

  return (
    <>
      {comparacao.media !== undefined && (
        <section className="cartao">
          <h2>Você e a turma</h2>
          <p className="texto-suave">Comparação com as provas já corrigidas da sua turma, sem identificar ninguém.</p>
          <Grafico
            titulo="Sua nota e a média da turma"
            dados={[
              { rotulo: 'Você', valor: nota.pontos },
              { rotulo: 'Média da turma', valor: comparacao.media },
            ]}
            sufixo=" pt"
            descricaoDica="de pontuação"
            maximo={nota.pontuacaoMaxima}
            altura={220}
          />
          <div className="tabela-rolavel">
            <table className="tabela">
              <caption className="apenas-leitor">Sua nota comparada à média da turma</caption>
              <thead>
                <tr>
                  <th scope="col">Quem</th>
                  <th scope="col">Nota</th>
                  <th scope="col">Aproveitamento</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Você</th>
                  <td>{formatarPontos(nota.pontos)}</td>
                  <td>{nota.percentual}%</td>
                </tr>
                <tr>
                  <th scope="row">Média da turma</th>
                  <td>{formatarPontos(comparacao.media)}</td>
                  <td>{comparacao.mediaPercentual}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {comparacao.distribuicao && (
        <section className="cartao">
          <h2>Distribuição das notas</h2>
          <p className="texto-suave">
            Quantas provas ficaram em cada faixa de aproveitamento.
            {comparacao.minhaFaixa && <> A sua ficou na faixa <strong>{comparacao.minhaFaixa}</strong>.</>}
          </p>
          <Grafico
            titulo="Distribuição das notas da turma, por faixa"
            // No eixo, a faixa vai encurtada ("0–20%"): por extenso, os cinco rótulos se
            // sobrepõem na largura de um telefone. A tabela abaixo mantém o texto completo.
            dados={comparacao.distribuicao.map((f) => ({
              rotulo: f.faixa.replace(' a ', '–').replace(/%.*/, '%'),
              rotuloCompleto: f.faixa,
              valor: f.total,
            }))}
            descricaoDica="prova(s)"
            altura={220}
          />
          <div className="tabela-rolavel">
            <table className="tabela">
              <caption className="apenas-leitor">Distribuição das notas por faixa</caption>
              <thead>
                <tr>
                  <th scope="col">Faixa</th>
                  <th scope="col">Provas</th>
                </tr>
              </thead>
              <tbody>
                {comparacao.distribuicao.map((f) => (
                  <tr key={f.faixa}>
                    <th scope="row">
                      {f.faixa}
                      {f.faixa === comparacao.minhaFaixa && <span className="etiqueta"> a sua</span>}
                    </th>
                    <td>{f.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {comparacao.destaques && (
        <section className="cartao">
          <h2>Como a turma foi em cada questão</h2>
          <p className="texto-suave">
            Percentual de aproveitamento da turma por questão — não diz quem acertou o quê.
          </p>
          <Grafico
            titulo="Aproveitamento da turma por questão"
            dados={comparacao.destaques.todas.map((q) => ({
              rotulo: `Q${q.ordem}`,
              rotuloCompleto: `Q${q.ordem} — ${q.enunciado}`,
              valor: q.indiceAcerto,
            }))}
            sufixo="%"
            descricaoDica="de aproveitamento"
            maximo={100}
          />
          {comparacao.destaques.maioresErros.length > 0 && (
            <div className="colunas-destaque">
              <div>
                <h3>A turma foi melhor em</h3>
                <ol className="lista-destaque">
                  {comparacao.destaques.maioresAcertos.map((q) => (
                    <li key={q.questaoId}>
                      <strong>{q.indiceAcerto}%</strong> · Q{q.ordem}
                      <p className="texto-suave sem-margem quebra">{q.enunciado}</p>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h3>A turma teve mais dificuldade em</h3>
                <ol className="lista-destaque">
                  {comparacao.destaques.maioresErros.map((q) => (
                    <li key={q.questaoId}>
                      <strong>{q.indiceAcerto}%</strong> · Q{q.ordem}
                      <p className="texto-suave sem-margem quebra">{q.enunciado}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function ResultadoDaProva({ avaliacaoId }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    api(`/estudante/avaliacoes/${avaliacaoId}/resultado`)
      .then((resposta) => ativo && setDados(resposta))
      .catch((falha) => ativo && setErro(falha.message));
    return () => {
      ativo = false;
    };
  }, [avaliacaoId]);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return <Carregando mensagem="Buscando o resultado…" />;

  if (!dados.liberado) {
    return (
      <section className="cartao">
        <h2>Resultado</h2>
        <p className="texto-suave sem-margem">{dados.motivo}</p>
      </section>
    );
  }

  return (
    <>
      <Nota nota={dados.nota} />

      {dados.questoes && (
        <section>
          <div className="secao-topo">
            <div>
              <h2>Sua prova, questão a questão</h2>
              <p>Na ordem em que você respondeu, com o que era esperado.</p>
            </div>
          </div>
          <ol className="lista-questoes-editor">
            {dados.questoes.map((questao) => (
              <QuestaoCorrigida key={questao.questaoId} questao={questao} />
            ))}
          </ol>
        </section>
      )}

      <Comparacao comparacao={dados.comparacao} nota={dados.nota} />
    </>
  );
}
