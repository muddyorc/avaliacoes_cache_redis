// UC12 — Exibir Dashboard de Desempenho (RF12).
//
// O professor escolhe o que analisar (uma avaliação ou uma turma) e o painel mostra os
// indicadores: média, distribuição das notas, estudantes abaixo da média e as questões
// com maior índice de acertos e de erros (P-14).
//
// Quem decide se há dado suficiente é o servidor (`temDados` / `motivoSemDados`): os
// fluxos alternativos A1 e A2 do UC12 aparecem como aviso explicando o motivo, nunca
// como um gráfico zerado — que seria lido como "a turma foi mal".
//
// Todo gráfico vem acompanhado da tabela com os mesmos números, logo abaixo: a cor e a
// altura da barra não podem ser o único jeito de ler o painel (RNF06).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { GraficoBarras } from '../componentes/GraficoBarras.jsx';
import { formatarPontos } from '../utils/datas.js';

const resumir = (texto, limite = 70) => (texto.length <= limite ? texto : `${texto.slice(0, limite).trimEnd()}…`);

const percentual = (valor) => (valor === null || valor === undefined ? '—' : `${valor}%`);

function Indicador({ rotulo, valor, detalhe }) {
  return (
    <div>
      <p className="placar-numero">{valor}</p>
      <p className="texto-suave sem-margem">{rotulo}</p>
      {detalhe && <p className="texto-suave sem-margem">{detalhe}</p>}
    </div>
  );
}

// Título + gráfico + tabela equivalente, sempre juntos.
function Bloco({ titulo, descricao, children }) {
  return (
    <section className="painel espaco-acima">
      <h2>{titulo}</h2>
      {descricao && <p className="texto-suave">{descricao}</p>}
      {children}
    </section>
  );
}

function Distribuicao({ distribuicao, unidade }) {
  const dados = distribuicao.map((f) => ({ rotulo: f.faixa, valor: f.total }));
  const total = distribuicao.reduce((soma, f) => soma + f.total, 0);
  return (
    <>
      <GraficoBarras
        dados={dados}
        titulo="Distribuição por faixa de aproveitamento"
        descricaoDica={unidade}
        altura={240}
      />
      <div className="tabela-rolavel">
        <table className="tabela">
          <caption className="apenas-leitor">Distribuição por faixa de aproveitamento</caption>
          <thead>
            <tr>
              <th scope="col">Faixa</th>
              <th scope="col">Quantidade</th>
              <th scope="col">Participação</th>
            </tr>
          </thead>
          <tbody>
            {distribuicao.map((f) => (
              <tr key={f.faixa}>
                <th scope="row">{f.faixa}</th>
                <td>{f.total}</td>
                <td>{total > 0 ? `${Math.round((f.total / total) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ------------------------------------------------------------ painel da avaliação

// A turma já foi escolhida antes de chegar aqui, então este painel não a recebe mais
// como filtro: ele mostra a avaliação DENTRO da turma selecionada, e ponto.
function PainelAvaliacao({ dados }) {
  const { avaliacao, participacao, resumo, distribuicao, questoes } = dados;
  const comIndice = questoes.filter((q) => q.indiceAcerto !== null);

  const estudantesDaProva = dados.estudantes ?? [];

  // Quando uma nota está "longe" da média? A banda é de 10% da pontuação da prova para
  // cada lado — numa prova de 10 pontos, quem ficar a mais de 1 ponto da média destoa.
  //
  // Escolha deliberada por algo explícito e explícavel, em vez de desvio-padrão: o
  // professor consegue conferir de cabeça, e numa turma de 6 pessoas o desvio-padrão
  // oscila demais para servir de semáforo.
  const banda = (avaliacao.pontuacaoMaxima || 0) * 0.1;
  const corDaNota = (nota) => {
    if (nota === null || resumo?.media === undefined) return undefined;
    if (nota >= avaliacao.pontuacaoMaxima) return 'situacao-ativa'; // acerto total
    if (nota > resumo.media + banda) return 'situacao-ativa';
    if (nota < resumo.media - banda) return 'texto-erro';
    return undefined; // perto da média: sem cor, que é o normal
  };

  // As cinco faixas são quintos da pontuação; o backend as calcula em percentual porque a
  // regra vale para qualquer prova. Aqui, com uma prova só em tela, elas viram nota.
  const faixasEmPontos = distribuicao.map((f, i) => ({
    ...f,
    faixa: `${formatarPontos((i * 20 * avaliacao.pontuacaoMaxima) / 100)} a ${formatarPontos(
      ((i + 1) * 20 * avaliacao.pontuacaoMaxima) / 100,
    )}`,
  }));

  return (
    <>
      <section className="painel">
        <div className="cabecalho-barra">
          <div>
            <h2 className="sem-margem">{avaliacao.titulo}</h2>
            <p className="texto-suave sem-margem">
              Vale {formatarPontos(avaliacao.pontuacaoMaxima)}
              {dados.turma ? ` · turma ${dados.turma.nome}` : ''}
              {avaliacao.resultadosLiberados ? ' · resultados liberados' : ' · resultados ainda não liberados'}
            </p>
          </div>
          <Link
            className="botao botao-secundario"
            to={`/professor/avaliacoes/${avaliacao.id}?aba=correcao`}
          >
            Abrir correção
          </Link>
        </div>

        {/* Havia aqui um "Restringir a uma turma". Saiu: com a turma escolhida no passo
            anterior, o filtro era a mesma pergunta feita duas vezes — e dava para pô-lo
            em desacordo com a turma de cima, mostrando números de outra turma sob um
            título que dizia esta. */}

        <div className="placar espaco-acima-pequeno">
          <Indicador rotulo="provas iniciadas" valor={participacao.tentativas} />
          <Indicador rotulo="entregues" valor={participacao.encerradas} />
          <Indicador rotulo="corrigidas" valor={participacao.corrigidas} />
          {participacao.aguardandoCorrecao > 0 && (
            <Indicador rotulo="aguardando correção" valor={participacao.aguardandoCorrecao} />
          )}
          {participacao.emAndamento > 0 && <Indicador rotulo="ainda fazendo" valor={participacao.emAndamento} />}
        </div>
      </section>

      {!dados.temDados ? (
        <section className="painel espaco-acima">
          <Aviso tipo="alerta">{dados.motivoSemDados}</Aviso>
        </section>
      ) : (
        <>
          <section className="painel espaco-acima">
            <h2>Desempenho geral</h2>
            {/* "5 provas" era ambíguo: em português "prova" é tanto o instrumento quanto a
                entrega de cada estudante, e ao lado de "média da turma" dava para ler como
                partes da avaliação. Dizer de QUEM são as provas resolve: são tentativas,
                uma por pessoa. */}
            <p className="texto-suave">
              Calculado sobre {participacao.corrigidas}{' '}
              {participacao.corrigidas === 1 ? 'estudante' : 'estudantes'} com a prova corrigida
              {participacao.aguardandoCorrecao > 0 &&
                ` — ${participacao.aguardandoCorrecao} ainda aguarda(m) correção`}
              .
            </p>
            <div className="placar">
              {/* Sem o percentual ao lado: este bloco descreve UMA prova, e nela a nota
                  já é o número que o professor entende. O percentual só ganha função onde
                  há provas de pontuações diferentes para comparar. */}
              <Indicador
                rotulo="média da turma"
                valor={formatarPontos(resumo.media)}
                detalhe={`de ${formatarPontos(avaliacao.pontuacaoMaxima)}`}
              />
              <Indicador rotulo="mediana" valor={formatarPontos(resumo.mediana)} />
              <Indicador rotulo="menor nota" valor={formatarPontos(resumo.menor)} />
              <Indicador rotulo="maior nota" valor={formatarPontos(resumo.maior)} />
            </div>
          </section>

          <Bloco
            titulo="Distribuição das notas"
            descricao={`Quantas provas ficaram em cada faixa de nota, de ${formatarPontos(avaliacao.pontuacaoMaxima)}.`}
          >
            {/* As faixas vinham rotuladas em percentual ("40 a 60%"). Aqui o recorte é UMA
                prova, com uma pontuação só: a faixa pode ser dita na nota de verdade, que
                é como o professor pensa. O cálculo não muda — são os mesmos cinco quintos. */}
            <Distribuicao distribuicao={faixasEmPontos} unidade="prova(s)" />
          </Bloco>

          <Bloco
            titulo="Desempenho por questão"
            descricao="Índice de acerto: nas objetivas, a porcentagem de provas que acertaram; nas discursivas, quanto da pontuação da questão a turma obteve, em média."
          >
            {comIndice.length === 0 ? (
              <p className="texto-suave">Ainda não há questões com dado suficiente.</p>
            ) : (
              <GraficoBarras
                dados={comIndice.map((q) => ({
                  rotulo: `Q${q.ordem}`,
                  rotuloCompleto: `Q${q.ordem} — ${resumir(q.enunciado)}`,
                  valor: q.indiceAcerto,
                }))}
                titulo="Índice de acerto por questão"
                sufixo="%"
                descricaoDica="de aproveitamento"
                maximo={100}
              />
            )}

            <div className="tabela-rolavel">
              <table className="tabela">
                <caption className="apenas-leitor">Índice de acerto por questão</caption>
                <thead>
                  <tr>
                    <th scope="col">Questão</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Vale</th>
                    <th scope="col">Índice de acerto</th>
                    <th scope="col">Sem resposta</th>
                  </tr>
                </thead>
                <tbody>
                  {questoes.map((q) => (
                    <tr key={q.questaoId}>
                      <th scope="row">
                        Q{q.ordem}
                        {/* 90 caracteres faziam esta coluna crescer até empurrar "Sem
                            resposta" para fora da tela, obrigando a rolar na horizontal
                            para ver um número. O enunciado aqui serve para reconhecer a
                            questão, não para lê-la — quem precisa do texto inteiro abre a
                            prova. 55 cabe junto com as outras quatro colunas. */}
                        <p className="texto-suave sem-margem quebra">{resumir(q.enunciado, 55)}</p>
                      </th>
                      <td>{q.tipo === 'OBJETIVA' ? 'Objetiva' : 'Discursiva'}</td>
                      <td>{formatarPontos(q.pontuacao)}</td>
                      <td>
                        {q.indiceAcerto === null ? (
                          <span className="texto-suave">—</span>
                        ) : (
                          <strong>{percentual(q.indiceAcerto)}</strong>
                        )}
                        {q.tipo === 'OBJETIVA' && q.totalProvas > 0 && (
                          <p className="texto-suave sem-margem">
                            {q.acertos} de {q.totalProvas}
                          </p>
                        )}
                      </td>
                      <td>{q.semResposta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Bloco>

          {/* Havia aqui um bloco "Destaques", com maiores acertos e maiores erros. Saiu:
              era a TERCEIRA forma do mesmo dado. O gráfico acima já mostra o índice de
              cada questão, e os destaques apontavam a barra mais alta e a mais baixa —
              sem trazer número que a tabela ao lado não tivesse. */}

          <section className="painel espaco-acima">
            <h2>Notas por estudante</h2>
            <p className="texto-suave">
              Nota de cada estudante nesta prova. A média da turma foi{' '}
              <strong>{formatarPontos(resumo.media)}</strong> de {formatarPontos(avaliacao.pontuacaoMaxima)}.{' '}
              <span className="texto-erro">Em vermelho</span>, quem ficou bem abaixo dela;{' '}
              <span className="situacao-ativa">em verde</span>, quem ficou bem acima ou acertou tudo.
            </p>
            {estudantesDaProva.length === 0 ? (
              <p className="texto-suave">Ninguém realizou esta avaliação ainda.</p>
            ) : (
              <div className="tabela-rolavel">
                <table className="tabela">
                  <caption className="apenas-leitor">Nota de cada estudante nesta avaliação</caption>
                  <thead>
                    <tr>
                      <th scope="col">Estudante</th>
                      <th scope="col">Nota</th>
                      <th scope="col">Aproveitamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estudantesDaProva.map((e) => (
                      <tr key={e.estudanteId}>
                        <th scope="row">
                          {/* O nome abre a PROVA do estudante nesta avaliação.
                              Antes levava ao histórico dele na turma, o que era um desvio:
                              quem está olhando os números de uma prova e clica num nome
                              quer ver aquela prova, não a trajetória da pessoa. */}
                          {e.tentativaId && !e.emAndamento ? (
                            <Link
                              className="ligacao-discreta"
                              // `turma` diz de onde o professor veio: o "Voltar" da
                              // prova devolve ao desempenho, e não à aba de correção.
                              to={`/professor/avaliacoes/${avaliacao.id}/correcao/${e.tentativaId}${
                                dados.turma ? `?turma=${dados.turma.id}` : ''
                              }`}
                            >
                              {e.nome}
                            </Link>
                          ) : (
                            e.nome
                          )}
                        </th>
                        <td className={corDaNota(e.nota)}>
                          {e.nota === null ? (
                            <span className="texto-suave">{e.emAndamento ? 'fazendo agora' : 'sem nota'}</span>
                          ) : (
                            <strong>{formatarPontos(e.nota)}</strong>
                          )}
                        </td>
                        <td>{e.percentual === null ? <span className="texto-suave">—</span> : percentual(e.percentual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

// -------------------------------------------------------------- contexto da turma

// Não é mais um painel concorrente: é o CONTEXTO da turma, que acompanha a escolha da
// prova em vez de substituí-la. Só contém o que não agrega provas diferentes num número
// só — a comparação entre elas (em percentual, por isso) e o quadro de notas.
function ContextoDaTurma({ dados }) {
  const { turma, avaliacoes } = dados;
  const comMedia = avaliacoes.filter((a) => a.mediaPercentual !== null);

  return (
    <>
      {/* Sem cabeçalho com o nome da turma: ela já está no título da página e no campo
          Turma, logo acima. Repetir no meio da tela não acrescenta e empurra o conteúdo
          para baixo. O "Abrir turma" foi para junto do campo, onde a turma é nomeada. */}
      {!dados.temDados ? (
        <section className="painel espaco-acima">
          <Aviso tipo="alerta">{dados.motivoSemDados}</Aviso>
        </section>
      ) : (
        <>
          {/* Saíram daqui "Desempenho geral" (média, mediana, menor e maior) e
              "Distribuição dos estudantes".

              Os dois consolidavam VÁRIAS provas num número só — a média das médias de
              cada estudante ao longo da turma —, e isso responde a uma pergunta que o
              professor não fez: ele quer o desempenho DAQUELA prova. Escolhida uma
              avaliação no seletor acima, os mesmos indicadores aparecem em pontos, e aí
              significam algo concreto.

              O que sobra neste painel ou compara provas de propósito (o gráfico por
              avaliação, em percentual, única forma honesta de comparar pontuações
              diferentes) ou não agrega nada (o quadro, que mostra cada nota como ela é). */}

          <Bloco
            titulo="Desempenho por avaliação"
            descricao="Média da turma em cada avaliação, em percentual da pontuação."
          >
            {comMedia.length === 0 ? (
              <p className="texto-suave">Nenhuma avaliação desta turma tem prova corrigida.</p>
            ) : (
              // ESTE gráfico fica em percentual mesmo quando as provas valem o mesmo, e é
              // o único assim: ele existe para comparar provas ENTRE SI, e comparar exige
              // denominador comum. Nos demais blocos o número descreve uma prova só, e aí
              // ponto diz mais ao professor do que percentual.
              <GraficoBarras
                dados={comMedia.map((a) => ({
                  rotulo: resumir(a.titulo, 14),
                  rotuloCompleto: a.titulo,
                  valor: a.mediaPercentual,
                }))}
                titulo="Média da turma por avaliação"
                sufixo="%"
                descricaoDica="de aproveitamento médio"
                maximo={100}
              />
            )}

            <div className="tabela-rolavel">
              <table className="tabela">
                <caption className="apenas-leitor">Média e participação em cada avaliação</caption>
                <thead>
                  <tr>
                    <th scope="col">Avaliação</th>
                    <th scope="col">Provas</th>
                    <th scope="col">Corrigidas</th>
                    <th scope="col">Média</th>
                    <th scope="col">Participação</th>
                    <th scope="col">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {avaliacoes.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.titulo}</th>
                      <td>{a.tentativas}</td>
                      <td>{a.corrigidas}</td>
                      <td>
                        {a.media === null ? (
                          <span className="texto-suave">—</span>
                        ) : (
                          <>
                            <strong>{formatarPontos(a.media)}</strong>
                            <p className="texto-suave sem-margem">{percentual(a.mediaPercentual)}</p>
                          </>
                        )}
                      </td>
                      <td>{percentual(a.participacao)}</td>
                      <td>
                        <Link
                          className="botao botao-secundario botao-pequeno"
                          to={`/professor/dashboard?avaliacao=${a.id}&turma=${turma.id}`}
                        >
                          Ver
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Bloco>

          {/* Havia aqui uma tabela "Estudantes" com nome, provas corrigidas, média e
              situação. Saiu quando o quadro da RF13 entrou abaixo (item 3): o quadro traz
              os mesmos nome e média, mais a nota em cada avaliação, o link para o
              histórico e a marca de quem saiu da turma — era superconjunto dela. A única
              coluna exclusiva, "abaixo da média", foi para a coluna Média do quadro. */}
        </>
      )}

      {/* Saiu daqui o quadro estudante × avaliação. Ele comparava várias provas lado a
          lado, e a tela passou a ser sobre UMA prova: "Notas por estudante", no painel
          acima, mostra a nota de cada um na prova escolhida, com cor para quem destoa da
          média. O histórico de cada estudante na turma continua a um clique — pelo nome,
          naquela mesma tabela. */}
    </>
  );
}

// ------------------------------------------------------------------------ a página

export function Dashboard() {
  const [parametros, setParametros] = useSearchParams();
  const avaliacaoId = parametros.get('avaliacao') ?? '';
  // `turmaAnalisada` é o nome antigo, de quando existiam duas abas. Lido ainda porque há
  // endereços com ele em telas já mostradas, e redirecionar custaria mais que aceitar.
  const turmaId = parametros.get('turma') ?? parametros.get('turmaAnalisada') ?? '';

  // Entrando pela turma, ela fica TRAVADA: o professor pediu o desempenho daquela turma,
  // e trocar a turma por baixo seria responder outra pergunta. Pelo menu ("Desempenho
  // geral") ela é escolhível.
  //
  // A diferença precisa aparecer no próprio controle, e não só no título: um `select` diz
  // "você pode trocar isto"; texto fixo diz "não pode". É a regra aprovada pelo autor —
  // a forma do elemento é a mensagem.
  const turmaTravada = parametros.get('fixa') === '1' && Boolean(turmaId);

  const [fontes, setFontes] = useState(null);
  const [dados, setDados] = useState(null);
  const [contexto, setContexto] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  // Com a turma travada, a lista de avaliações vem recortada por ela (item 4): quem
  // entrou pelo painel de uma turma não deve receber provas de outras ao trocar de aba.
  useEffect(() => {
    let ativo = true;
    api(turmaId ? `/dashboard?turmaId=${turmaId}` : '/dashboard')
      .then((resposta) => ativo && setFontes(resposta))
      .catch((falha) => ativo && setErro(falha.message));
    return () => {
      ativo = false;
    };
  }, [turmaId]);

  // Trocar de avaliação troca a tela inteira, mas a rolagem ficava onde estava — o
  // professor clicava em "Ver" no fim da tabela e continuava no fim, olhando os números
  // de outra prova sem perceber que mudaram. Subir ao topo é o que torna a troca
  // perceptível.
  //
  // `smooth` só para quem não pediu menos movimento: animação de rolagem incomoda quem
  // tem sensibilidade vestibular, e o sistema respeita essa preferência.
  useEffect(() => {
    if (!avaliacaoId) return;
    const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduzir ? 'auto' : 'smooth' });
  }, [avaliacaoId]);

  // O nome sai da lista de fontes; antes dela carregar, o título fica genérico.
  const nomeDaTurma = fontes?.turmas?.find((t) => String(t.id) === String(turmaId))?.nome ?? '';

  // Uma seleção por vez: trocar de aba ou de alvo limpa o painel anterior.
  const selecionar = useCallback(
    (novos) => {
      setDados(null);
      setErro('');
      setParametros(novos, { replace: true });
    },
    [setParametros],
  );

  // O destino sai do que está selecionado, e não do histórico do navegador — assim
  // funciona também depois de recarregar a página ou de abrir o endereço direto.
  //
  // E o RÓTULO acompanha o destino. Com "Voltar" fixo, o mesmo botão levava à turma num
  // estado e ao início noutro, sem avisar qual — e quem usou "Ver outra turma" esperava
  // desfazer esse passo, que é coisa do botão do navegador, não deste.
  const voltar = turmaId
    ? { para: `/professor/turmas/${turmaId}`, rotulo: 'Abrir a turma' }
    : avaliacaoId
      ? { para: `/professor/avaliacoes/${avaliacaoId}`, rotulo: 'Abrir a avaliação' }
      : { para: '/professor', rotulo: 'Ir para o início' };

  // Um caminho só, em dois passos: a turma é sempre o primeiro, e a avaliação é o
  // segundo, opcional. Sem avaliação escolhida, o painel é o da turma inteira.
  //
  // Antes havia duas abas — "Por avaliação" e "Por turma" — que eram dois modos de
  // perguntar a mesma coisa, e nenhum deles começava onde o professor começa. A avaliação
  // sempre pertence a uma turma; escolher a turma primeiro é a ordem natural.
  // Duas cargas independentes, e não uma ou outra:
  //
  //   - o CONTEXTO da turma (as avaliações dela e o quadro de notas) acompanha a turma e
  //     fica na tela o tempo todo;
  //   - os INDICADORES são da prova escolhida, e entram abaixo quando houver uma.
  //
  // Antes era um ou outro, e escolher a prova trocava a tela inteira — o professor via
  // dois painéis diferentes e perguntava, com razão, por que não eram o mesmo. Agora é uma
  // tela só: escolher a prova ACRESCENTA, não substitui.
  useEffect(() => {
    // Também depende da avaliação: nada aparece antes de escolher uma, então buscar o
    // contexto antes disso seria uma requisição para uma tela que ninguém vai ver.
    if (!turmaId || !avaliacaoId) {
      setContexto(null);
      return undefined;
    }
    let ativo = true;
    api(`/dashboard/turmas/${turmaId}`)
      .then((r) => ativo && setContexto(r))
      .catch((falha) => ativo && setErro(falha.message));
    return () => {
      ativo = false;
    };
  }, [turmaId, avaliacaoId]);

  useEffect(() => {
    if (!turmaId || !avaliacaoId) {
      setDados(null);
      return undefined;
    }
    let ativo = true;
    setCarregando(true);
    api(`/dashboard/avaliacoes/${avaliacaoId}?turmaId=${turmaId}`)
      .then((resposta) => ativo && setDados(resposta))
      .catch((falha) => {
        if (ativo) {
          setDados(null);
          setErro(falha.message);
        }
      })
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [avaliacaoId, turmaId]);

  return (
    // Dentro do Layout: o menu lateral acompanha a tela, como no Início e nas Turmas.
    // O Layout já traz o seu próprio `<main>`, então aqui vai uma `<div>`.
    <Layout titulo="Desempenho">
      <div className="conteudo-central">
      <header className="cabecalho cabecalho-barra">
        <div>
          {/* O título diz em qual recorte o professor está. Entrando por uma turma ele
              nasce com o nome dela; pelo menu, só "Desempenho" até a escolha. */}
          <h1>{nomeDaTurma ? `Desempenho — ${nomeDaTurma}` : 'Desempenho'}</h1>
          <p>
            {turmaTravada
              ? 'Indicadores desta turma, a partir das provas já corrigidas.'
              : 'Escolha a turma e, se quiser, uma avaliação dela.'}
          </p>
        </div>
        <Link className="botao botao-secundario" to={voltar.para}>
          {voltar.rotulo}
        </Link>
      </header>

      <Aviso tipo="erro">{erro}</Aviso>

      {!fontes && !erro && <Carregando mensagem="Carregando suas avaliações e turmas…" />}

      {fontes && (
        <section className="painel">
          {/* Um caminho, em dois passos — e não duas abas.
              "Por avaliação" e "Por turma" eram dois modos de perguntar a mesma coisa, e
              nenhum começava por onde o professor começa. Toda avaliação pertence a uma
              turma: escolher a turma primeiro é a ordem natural, e a avaliação passa a
              ser um refinamento opcional dentro dela. */}
          {turmaTravada ? (
            // Turma travada: texto fixo, nunca um `select` desabilitado. Um seletor
            // cinzento convidaria ao clique que não funciona; texto diz a verdade de
            // imediato. E a válvula de escape vem junto — é ela que ensina, no momento
            // exato em que o professor quer trocar, que o painel geral existe.
            <div className="campo">
              <p className="sem-margem">
                <strong>Turma:</strong> {nomeDaTurma || 'carregando…'}
              </p>
              {/* Separados por "·", e não só por espaço: dois links de texto puro lado a
                  lado, sem borda nem fundo, são lidos como uma frase única — "Ver outra
                  turma Abrir turma". O ponto marca onde um termina e o outro começa,
                  e é o mesmo recurso que o resto da interface já usa. */}
              <p className="texto-suave sem-margem espaco-acima-pequeno">
                <Link className="ligacao-discreta" to="/professor/dashboard">
                  Ver outra turma
                </Link>
                {' · '}
                <Link className="ligacao-discreta" to={`/professor/turmas/${turmaId}`}>
                  Abrir turma
                </Link>
              </p>
            </div>
          ) : (
            <div className="campo">
              <label htmlFor="turma">Turma</label>
              <select
                id="turma"
                value={turmaId}
                onChange={(e) => selecionar(e.target.value ? { turma: e.target.value } : {})}
              >
                <option value="">Selecione…</option>
                {fontes.turmas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome} — {t.totalEstudantes} estudante(s), {t.totalAvaliacoes} avaliação(ões)
                  </option>
                ))}
              </select>
              {fontes.turmas.length === 0 && <p className="campo-dica">Você ainda não criou turmas.</p>}
              {turmaId && (
                <Link className="ligacao-discreta" to={`/professor/turmas/${turmaId}`}>
                  Abrir turma
                </Link>
              )}
            </div>
          )}

          {/* O segundo passo só existe depois do primeiro: sem turma não há lista de
              avaliações a oferecer. Sem avaliação escolhida, o painel é o da turma. */}
          {turmaId && (
            <div className="campo">
              <label htmlFor="avaliacao">Avaliação</label>
              <select
                id="avaliacao"
                value={avaliacaoId}
                onChange={(e) =>
                  selecionar(
                    e.target.value
                      ? { turma: turmaId, avaliacao: e.target.value, ...(turmaTravada ? { fixa: '1' } : {}) }
                      : { turma: turmaId, ...(turmaTravada ? { fixa: '1' } : {}) },
                  )
                }
              >
                <option value="">Selecione…</option>
                {fontes.avaliacoes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.titulo}
                    {a.temDados ? ` — ${a.corrigidas} corrigida(s)` : ' — sem prova corrigida'}
                  </option>
                ))}
              </select>
              {fontes.avaliacoes.length === 0 && (
                <p className="campo-dica">Nenhuma avaliação vinculada a esta turma ainda.</p>
              )}
            </div>
          )}
        </section>
      )}

      {carregando && <Carregando mensagem="Calculando os indicadores…" />}

      {/* Nada é mostrado antes da escolha da prova — nem os gráficos da turma. Meio
          painel preenchido convida a tirar conclusão de um recorte que ainda não foi
          feito; a tela em branco diz com clareza que falta um passo. */}
      {turmaId && !avaliacaoId && (
        <section className="painel espaco-acima">
          <Aviso tipo="alerta">
            Escolha uma avaliação acima. Os indicadores, a distribuição das notas, o desempenho por
            questão e o quadro da turma aparecem todos juntos depois da escolha.
          </Aviso>
        </section>
      )}

      {dados && !carregando && avaliacaoId && (
        <div className="espaco-acima">
          <PainelAvaliacao dados={dados} />
        </div>
      )}

      {/* O contexto da turma fica sempre: ele não concorre com os indicadores acima, e é
          o que permite ver a prova escolhida em relação às outras da mesma turma. */}
        {contexto && (
          <div className="espaco-acima">
            <ContextoDaTurma dados={contexto} />
          </div>
        )}
      </div>
    </Layout>
  );
}
