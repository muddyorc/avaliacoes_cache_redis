// UC11 — corrigir a prova de um estudante (RF11, parcial).
//
// Objetivas: o sistema já corrigiu; a tela apenas mostra o que o estudante marcou e qual
// era a correta. Discursivas: o professor lê a resposta ao lado da referência e atribui
// nota e feedback (P-08). A nota final é sempre decisão do professor (RN04).
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { formatarDataHora, formatarPontos } from '../utils/datas.js';
import { SugestaoIA } from '../componentes/SugestaoIA.jsx';
import { AvisoDeLeitura, LinhaDoTempo } from '../componentes/LinhaDoTempo.jsx';

const LETRAS = 'ABCDEFGHIJ';

// Acerto parcial: tirou alguma coisa, mas não tudo. Só acontece na questão de múltipla
// escolha (P-26); nas demais a nota automática é tudo ou nada.
const parcial = (q) => {
  const nota = Number(q.notaFinal ?? 0);
  return nota > 0 && nota < Number(q.pontuacao);
};

export function CorrigirTentativa() {
  const { id, tentativaId } = useParams();

  // Esta tela tem DOIS pontos de entrada legítimos: a aba de correção da prova e a tabela
  // "Notas por estudante" do desempenho. Sem saber de onde veio, "Voltar" sempre levava à
  // correção — e quem chegou pelo desempenho era despejado noutro lugar.
  //
  // A origem viaja na URL em vez de depender do histórico do navegador: `navigate(-1)`
  // não tem para onde ir quando se abre o endereço direto ou se recarrega a página, e
  // justamente aí o botão precisa funcionar.
  const [parametros] = useSearchParams();
  const turmaDeOrigem = parametros.get('turma');
  const voltarPara = turmaDeOrigem
    ? `/professor/dashboard?turma=${turmaDeOrigem}&avaliacao=${id}&fixa=1`
    : `/professor/avaliacoes/${id}?aba=correcao`;
  const rotuloVoltar = turmaDeOrigem ? 'Voltar para o desempenho' : 'Voltar para a correção';

  const [dados, setDados] = useState(null);
  const [notas, setNotas] = useState({});
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [mensagem, setMensagem] = useState('');
  const [salvando, setSalvando] = useState(false);
  // RF11: a análise das discursivas acontece ao abrir a prova. `recusadas` guarda as
  // questões em que o professor dispensou a sugestão e assumiu a correção.
  const [analisando, setAnalisando] = useState(false);
  const [recusadas, setRecusadas] = useState({});

  const aplicar = useCallback((d) => {
    setDados(d);
    const iniciais = {};
    for (const q of d.questoes) {
      if (q.tipo !== 'DISCURSIVA') continue;
      iniciais[q.questaoId] = {
        nota: q.notaFinal == null ? '' : String(q.notaFinal).replace('.', ','),
        feedback: q.feedback ?? '',
      };
    }
    setNotas(iniciais);
  }, []);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const detalhe = await api(`/correcao/${id}/tentativas/${tentativaId}`);
        if (!ativo) return;
        aplicar(detalhe);

        // RF11: o professor abriu a prova, então as discursivas sem sugestão são
        // analisadas agora. Falha aqui não atrapalha a correção — cada questão mostra o
        // próprio estado, e quem quiser corrige à mão.
        const pendentes = detalhe.questoes.filter(
          (q) => q.tipo === 'DISCURSIVA' && q.texto?.trim() && !q.sugestaoIA && q.notaFinal == null,
        );
        if (pendentes.length === 0) return;

        setAnalisando(true);
        try {
          await api(`/correcao/${id}/tentativas/${tentativaId}/sugestoes`, { metodo: 'POST' });
          if (!ativo) return;
          // Recarrega para trazer as sugestões já gravadas, cada uma com o seu modelo.
          aplicar(await api(`/correcao/${id}/tentativas/${tentativaId}`));
        } finally {
          if (ativo) setAnalisando(false);
        }
      } catch (falha) {
        if (ativo) setErro(falha.message);
      }
    }

    carregar();
    return () => {
      ativo = false;
    };
  }, [id, tentativaId, aplicar]);

  async function salvar() {
    setErro('');
    setMensagem('');
    setCampos({});

    // Só vai para o servidor a discursiva que recebeu nota; as em branco continuam
    // pendentes, e a correção só fecha quando todas tiverem nota.
    const correcoes = Object.entries(notas)
      .filter(([, v]) => String(v.nota).trim() !== '')
      .map(([questaoId, v]) => ({
        questaoId: Number(questaoId),
        nota: String(v.nota).replace(',', '.'),
        feedback: v.feedback?.trim() ? v.feedback : null,
      }));

    if (correcoes.length === 0) {
      setErro('Dê nota a ao menos uma questão discursiva antes de salvar.');
      return;
    }

    setSalvando(true);
    try {
      const atualizado = await api(`/correcao/${id}/tentativas/${tentativaId}`, { metodo: 'PUT', corpo: { correcoes } });
      aplicar(atualizado);
      setMensagem(
        atualizado.tentativa.correcaoConcluida
          ? `Correção concluída. Nota: ${formatarPontos(atualizado.tentativa.pontuacaoTotal)}.`
          : 'Notas salvas. Ainda faltam questões para concluir a correção.',
      );
      window.scrollTo(0, 0);
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
    } finally {
      setSalvando(false);
    }
  }

  if (!dados && !erro) {
    return (
      <main className="pagina">
        <Carregando mensagem="Abrindo a prova…" />
      </main>
    );
  }
  if (!dados) {
    return (
      <main className="pagina">
        <Aviso tipo="erro">{erro}</Aviso>
        <Link to={`/professor/avaliacoes/${id}?aba=correcao`}>Voltar para a correção</Link>
      </main>
    );
  }

  const { tentativa, questoes, monitoramento } = dados;
  const discursivas = questoes.filter((q) => q.tipo === 'DISCURSIVA');
  const pendentes = discursivas.filter((q) => String(notas[q.questaoId]?.nota ?? '').trim() === '').length;

  return (
    <main className="pagina pagina-larga">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>{tentativa.estudante.nome}</h1>
          <p className="quebra">
            {tentativa.estudante.email}
            {tentativa.finalizadaEm && ` · entregue em ${formatarDataHora(tentativa.finalizadaEm)}`}
            {tentativa.status === 'TEMPO_ESGOTADO' && ' · encerrada por tempo'}
            {tentativa.status === 'NAO_REALIZADA' && ' · não realizada: o prazo venceu sem a prova ser aberta'}
          </p>
          {/* Por que esta prova foi devolvida. Fica junto do nome porque muda a leitura
              de tudo o que vem abaixo — inclusive de quanto tempo a pessoa teve. */}
          {tentativa.reaberturas?.map((r) => (
            <p className="cartao-aviso" key={r.reabertaEm}>
              Prova devolvida em {formatarDataHora(r.reabertaEm)} por {r.professor}, com {r.minutos}{' '}
              {r.minutos === 1 ? 'minuto' : 'minutos'}. Motivo: {r.motivo}
            </p>
          ))}
        </div>
        {/* O rótulo nomeia o destino: "Voltar" sozinho deixa o professor adivinhar, e
            adivinhar errado é o que faz perder o fio. */}
        <Link className="botao botao-secundario" to={voltarPara}>
          {rotuloVoltar}
        </Link>
      </header>

      <Aviso tipo="erro">{erro}</Aviso>
      <Aviso tipo="sucesso">{mensagem}</Aviso>

      <section className="painel">
        <div className="placar">
          <div>
            <p className="placar-numero">{formatarPontos(tentativa.pontuacaoObjetiva ?? 0)}</p>
            <p className="texto-suave sem-margem">nas objetivas (automático)</p>
          </div>
          <div>
            <p className="placar-numero">
              {tentativa.pontuacaoTotal == null ? '—' : formatarPontos(tentativa.pontuacaoTotal)}
            </p>
            <p className="texto-suave sem-margem">
              {tentativa.correcaoConcluida ? 'nota final' : `falta corrigir ${pendentes} discursiva(s)`}
            </p>
          </div>
          {monitoramento?.ocorrencias > 0 && (
            <div>
              <p className="placar-numero">{monitoramento.ocorrencias}</p>
              <p className="texto-suave sem-margem">ocorrências registradas</p>
            </div>
          )}
        </div>
      </section>

      {/* RF10 junto da correção (item 9 do feedback). Até aqui, para saber o que o
          navegador registrou nesta prova o professor precisava abrir outra tela e cruzar
          os nomes à mão — o dado chegava longe da decisão que ele informa.

          O aviso vem junto, e não como rodapé: na mesma tela que a nota, o convite a
          tratar ocorrência como prova de cópia é maior do que era quando as telas eram
          separadas. O sistema não liga os dois números, e quem lê precisa saber disso. */}
      {monitoramento?.ocorrencias > 0 && (
        <section className="painel espaco-acima">
          <h2>Monitoramento desta prova</h2>
          <AvisoDeLeitura />
          <LinhaDoTempo
            avaliacaoId={id}
            tentativaId={tentativaId}
            eventos={monitoramento.eventos}
            estudante={tentativa.estudante.nome}
          />
        </section>
      )}

      {questoes.map((q, i) => (
        <section key={q.questaoId} className="painel espaco-acima">
          <p className="questao-prova-cabecalho">
            <span>
              Questão {i + 1} · {q.tipo === 'OBJETIVA' ? 'objetiva' : 'discursiva'}
            </span>
            <span className="texto-suave">vale {formatarPontos(q.pontuacao)}</span>
          </p>
          <p className="questao-prova-enunciado">{q.enunciado}</p>

          {q.tipo === 'OBJETIVA' ? (
            <>
              {/* A nota vem do servidor, e não de "acertou ou não": na questão de múltipla
                  escolha ela é parcial (P-26), e deduzi-la do acerto mostrava 0 ponto numa
                  questão que valeu 2. */}
              <p className={q.correta ? 'situacao-ativa' : parcial(q) ? '' : 'texto-erro'}>
                {q.correta ? 'Acertou' : parcial(q) ? 'Acertou em parte' : q.respondida ? 'Errou' : 'Em branco'} ·{' '}
                {formatarPontos(q.notaFinal ?? (q.correta ? q.pontuacao : 0))} — corrigida automaticamente
              </p>
              {q.multiplasCorretas && (
                <p className="texto-suave sem-margem">
                  Questão de múltipla escolha: {q.alternativas.filter((a) => a.correta).length} alternativa(s)
                  correta(s). A nota é proporcional ao que o estudante acertou, descontando o que marcou errado.
                </p>
              )}
              <ul className="alternativas-resultado">
                {q.alternativas.map((a, j) => {
                  // P-26: numa questão de múltipla escolha a marcação é um conjunto.
                  const marcada =
                    a.id === q.alternativaMarcada || (q.alternativasMarcadas ?? []).includes(a.id);
                  return (
                    <li key={a.id} className={`${a.correta ? 'alternativa-certa' : ''}${marcada && !a.correta ? ' alternativa-errada' : ''}`}>
                      <span className="opcao-prova-letra">{LETRAS[j]}</span> {a.texto}
                      {a.correta && <strong> — correta</strong>}
                      {marcada && <strong> (marcada pelo estudante)</strong>}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              <div className="comparacao-discursiva">
                <div>
                  <h3>Resposta do estudante</h3>
                  <p className="instrucoes">{q.texto || <em className="texto-suave">Em branco</em>}</p>
                </div>
                <div>
                  <h3>Resposta esperada</h3>
                  <p className="instrucoes">{q.respostaEsperada}</p>
                  {q.criteriosCorrecao && (
                    <>
                      <h3>Critérios de correção</h3>
                      <p className="instrucoes">{q.criteriosCorrecao}</p>
                    </>
                  )}
                </div>
              </div>

              {/* RF11: apoio à correção. A nota final continua sendo do professor (RN04). */}
              <SugestaoIA
                avaliacaoId={id}
                tentativaId={tentativaId}
                questao={q}
                analisando={analisando}
                recusada={Boolean(recusadas[q.questaoId])}
                aoAprovar={(nota) =>
                  setNotas((atual) => ({ ...atual, [q.questaoId]: { ...atual[q.questaoId], nota } }))
                }
                aoRecusar={() => setRecusadas((atual) => ({ ...atual, [q.questaoId]: true }))}
              />

              <div className="linha-campos espaco-acima-pequeno">
                <div className="campo">
                  <label htmlFor={`nota-${q.questaoId}`}>Nota (até {formatarPontos(q.pontuacao)})</label>
                  {/* Enquanto há sugestão aguardando decisão, o campo fica fechado: é o que
                      torna visível que existe algo a aprovar ou recusar ali. Recusar
                      devolve o campo na hora. */}
                  <input
                    id={`nota-${q.questaoId}`}
                    inputMode="decimal"
                    aria-invalid={campos[`nota.${q.questaoId}`] ? 'true' : undefined}
                    disabled={
                      Boolean(q.sugestaoIA) &&
                      !recusadas[q.questaoId] &&
                      String(notas[q.questaoId]?.nota ?? '').trim() === ''
                    }
                    value={notas[q.questaoId]?.nota ?? ''}
                    onChange={(e) =>
                      setNotas((atual) => ({ ...atual, [q.questaoId]: { ...atual[q.questaoId], nota: e.target.value } }))
                    }
                  />
                  {campos[`nota.${q.questaoId}`] && <p className="campo-erro">{campos[`nota.${q.questaoId}`]}</p>}
                </div>
              </div>
              <div className="campo">
                <label htmlFor={`feedback-${q.questaoId}`}>Feedback para o estudante (opcional)</label>
                <textarea
                  id={`feedback-${q.questaoId}`}
                  rows={3}
                  value={notas[q.questaoId]?.feedback ?? ''}
                  onChange={(e) =>
                    setNotas((atual) => ({ ...atual, [q.questaoId]: { ...atual[q.questaoId], feedback: e.target.value } }))
                  }
                />
              </div>
              {q.corrigidaEm && <p className="texto-suave">Corrigida em {formatarDataHora(q.corrigidaEm)}.</p>}
            </>
          )}
        </section>
      ))}

      {discursivas.length === 0 ? (
        <p className="texto-suave espaco-acima">
          Esta prova só tem questões objetivas: a correção já está concluída pelo sistema.
        </p>
      ) : (
        <div className="barra-acoes espaco-acima">
          <button className="botao" type="button" disabled={salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar correção'}
          </button>
          <Link className="botao botao-secundario" to={voltarPara}>
            Voltar sem salvar
          </Link>
        </div>
      )}
    </main>
  );
}
