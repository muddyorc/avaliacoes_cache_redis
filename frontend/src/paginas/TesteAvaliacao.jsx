// P-20 — o professor faz a própria prova como teste.
//
// Segue o mesmo caminho que o estudante seguirá (UC08): vê título, instruções e tempo,
// inicia, responde com o cronômetro correndo e entrega. A diferença é que NADA é
// gravado: não existe tentativa, então a avaliação não fica bloqueada (P-15a) e o teste
// não aparece em resultados. As respostas vivem só nesta página até a entrega.
//
// Limitações do teste, por serem de etapas futuras: o monitoramento de integridade
// (Etapa 9) não é simulado, e o cronômetro roda no navegador, e não no servidor (DT06).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { QuestaoResposta } from '../componentes/QuestaoResposta.jsx';
import { formatarDuracao, formatarPontos } from '../utils/datas.js';
import { pedirTelaCheia, sairDaTelaCheia } from '../utils/telaCheia.js';

const LETRAS = 'ABCDEFGHIJ';

function formatarRelogio(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

export function TesteAvaliacao() {
  const { id } = useParams();

  const [prova, setProva] = useState(null);
  const [erro, setErro] = useState('');
  const [fase, setFase] = useState('instrucoes'); // instrucoes | respondendo | resultado

  // A tela cheia é do teste, como é da prova: terminou, volta ao normal.
  useEffect(() => {
    // Mesma razão da prova: só ao terminar, nunca na montagem.
    if (fase === 'resultado') sairDaTelaCheia();
  }, [fase]);

  // Sair da tela do teste também encerra a tela cheia. Sem dependências: com `[fase]`,
  // a limpeza rodaria a cada troca e derrubaria a tela cheia recém-aberta.
  useEffect(() => sairDaTelaCheia, []);
  const [respostas, setRespostas] = useState({});
  const [restante, setRestante] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [tempoEsgotado, setTempoEsgotado] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const fimRef = useRef(0);
  // Trava contra entrega dupla: o cronômetro pode disparar de novo antes de a resposta
  // da primeira entrega chegar.
  const entregandoRef = useRef(false);

  useEffect(() => {
    let ativo = true;
    api(`/avaliacoes/${id}/teste`)
      .then((d) => ativo && setProva(d.avaliacao))
      .catch((f) => ativo && setErro(f.message));
    return () => {
      ativo = false;
    };
  }, [id]);

  const entregar = useCallback(
    async (porTempo = false) => {
      if (entregandoRef.current) return;
      entregandoRef.current = true;
      setEntregando(true);
      setErro('');
      try {
        const lista = Object.entries(respostas).map(([questaoId, r]) => ({
          questaoId: Number(questaoId),
          alternativaId: r.alternativaId ?? null,
          texto: r.texto ?? null,
        }));
        setResultado(await api(`/avaliacoes/${id}/teste/correcao`, { metodo: 'POST', corpo: { respostas: lista } }));
        setTempoEsgotado(porTempo);
        setFase('resultado');
        window.scrollTo(0, 0);
      } catch (falha) {
        setErro(falha.message);
      } finally {
        entregandoRef.current = false;
        setEntregando(false);
      }
    },
    [id, respostas],
  );

  // Cronômetro: calcula pelo horário de término, e não decrementando, para não
  // atrasar quando a aba fica em segundo plano.
  useEffect(() => {
    if (fase !== 'respondendo') return undefined;
    const tique = () => {
      const falta = fimRef.current - Date.now();
      setRestante(falta);
      if (falta <= 0) entregar(true);
    };
    const intervalo = setInterval(tique, 1000);
    return () => clearInterval(intervalo);
  }, [fase, entregar]);

  // Avisa antes de sair da página no meio do teste: as respostas não são salvas.
  useEffect(() => {
    if (fase !== 'respondendo') return undefined;
    const avisar = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [fase]);

  function iniciar() {
    fimRef.current = Date.now() + prova.duracaoMinutos * 60000;
    setRestante(prova.duracaoMinutos * 60000);
    setRespostas({});
    setResultado(null);
    setTempoEsgotado(false);
    // O teste é a prova como o estudante a veria (P-20), e isso inclui a tela cheia:
    // sem ela, o professor conferiria uma tela diferente da que vai ser aplicada.
    pedirTelaCheia();
    setFase('respondendo');
    window.scrollTo(0, 0);
  }

  function finalizar() {
    const respondidas = Object.values(respostas).filter((r) => r.alternativaId != null || r.texto?.trim()).length;
    const faltam = prova.questoes.length - respondidas;
    const aviso = faltam > 0 ? `\n\n${faltam} questão(ões) em branco valem 0 nas objetivas.` : '';
    if (!window.confirm(`Entregar o teste agora?${aviso}`)) return;
    entregar(false);
  }

  if (!prova && !erro) {
    return (
      <main className="pagina">
        <Carregando mensagem="Preparando o teste…" />
      </main>
    );
  }

  if (!prova) {
    return (
      <main className="pagina">
        <Aviso tipo="erro">{erro}</Aviso>
        <Link to={`/professor/avaliacoes/${id}`}>Voltar para a avaliação</Link>
      </main>
    );
  }

  const faixa = (
    <p className="aviso aviso-alerta faixa-teste" role="note">
      <strong>Modo de teste.</strong> Nada é salvo: a avaliação não fica bloqueada e este teste não aparece nos
      resultados.
    </p>
  );

  // ------------------------------------------------------------------- instruções
  if (fase === 'instrucoes') {
    return (
      <main className="pagina">
        {faixa}
        <header className="cabecalho">
          <h1>{prova.titulo}</h1>
          <p>
            {prova.questoes.length} {prova.questoes.length === 1 ? 'questão' : 'questões'} ·{' '}
            {formatarPontos(prova.pontuacaoTotal)} · {formatarDuracao(prova.duracaoMinutos)}
          </p>
        </header>
        <section className="painel">
          <h2>Instruções</h2>
          <p className="instrucoes">{prova.descricao || 'Sem instruções adicionais.'}</p>
          <p className="texto-suave">
            Ao iniciar, o cronômetro começa a contar {formatarDuracao(prova.duracaoMinutos)}. Quando o tempo acabar, o
            teste é entregue automaticamente. O monitoramento de integridade não é simulado no teste.
          </p>
          <div className="barra-acoes">
            <button className="botao" type="button" onClick={iniciar}>
              Iniciar teste
            </button>
            <Link className="botao botao-secundario" to={`/professor/avaliacoes/${id}`}>
              Voltar
            </Link>
          </div>
        </section>
      </main>
    );
  }

  // ------------------------------------------------------------------ respondendo
  if (fase === 'respondendo') {
    const poucoTempo = restante <= 60000;
    return (
      <main className="pagina">
        {faixa}
        <div className="barra-prova">
          <h1 className="barra-prova-titulo">{prova.titulo}</h1>
          <p className={`cronometro${poucoTempo ? ' cronometro-alerta' : ''}`} role="timer" aria-live="off">
            <span className="apenas-leitor">Tempo restante: </span>
            {formatarRelogio(restante)}
          </p>
        </div>

        <Aviso tipo="erro">{erro}</Aviso>

        {prova.questoes.map((q, i) => (
          <QuestaoResposta
            key={q.questaoId}
            questao={q}
            numero={i + 1}
            resposta={respostas[q.questaoId]}
            desabilitado={entregando}
            aoResponder={(valor) => setRespostas((atual) => ({ ...atual, [q.questaoId]: valor }))}
          />
        ))}

        <div className="barra-acoes">
          <button className="botao" type="button" onClick={finalizar} disabled={entregando}>
            {entregando ? 'Entregando…' : 'Entregar teste'}
          </button>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------- resultado
  const { resumo, itens } = resultado;
  const porId = new Map(prova.questoes.map((q) => [q.questaoId, q]));

  return (
    <main className="pagina">
      {faixa}
      <header className="cabecalho">
        <h1>Resultado do teste</h1>
        <p>{prova.titulo}</p>
      </header>

      {tempoEsgotado && <Aviso tipo="erro">O tempo acabou e o teste foi entregue automaticamente.</Aviso>}

      <section className="painel">
        <div className="placar">
          <div>
            <p className="placar-numero">
              {formatarPontos(resumo.pontosObjetivas)} <span className="texto-suave">de {formatarPontos(resumo.totalObjetivas)}</span>
            </p>
            <p className="texto-suave sem-margem">nas questões objetivas (correção automática)</p>
          </div>
          {resumo.totalDiscursivas > 0 && (
            <div>
              <p className="placar-numero">{formatarPontos(resumo.totalDiscursivas)}</p>
              <p className="texto-suave sem-margem">em discursivas, corrigidas pelo professor</p>
            </div>
          )}
        </div>
      </section>

      {itens.map((item, i) => {
        const q = porId.get(item.questaoId);
        return (
          <section key={item.questaoId} className="painel espaco-acima resultado-questao">
            <p className="questao-prova-cabecalho">
              <span>Questão {i + 1}</span>
              {item.tipo === 'OBJETIVA' ? (
                <span className={item.acertou ? 'situacao-ativa' : 'texto-erro'}>
                  {item.acertou ? 'Acertou' : item.respondida ? 'Errou' : 'Em branco'} · {formatarPontos(item.pontosObtidos)} de{' '}
                  {formatarPontos(item.pontuacao)}
                </span>
              ) : (
                <span className="texto-suave">Discursiva · vale {formatarPontos(item.pontuacao)}</span>
              )}
            </p>
            <p className="questao-prova-enunciado">{q.enunciado}</p>

            {item.tipo === 'OBJETIVA' ? (
              <ul className="alternativas-resultado">
                {q.alternativas.map((a, j) => {
                  const correta = a.id === item.alternativaCorreta;
                  const marcada = a.id === item.alternativaMarcada;
                  return (
                    <li
                      key={a.id}
                      className={`${correta ? 'alternativa-certa' : ''}${marcada && !correta ? ' alternativa-errada' : ''}`}
                    >
                      <span className="opcao-prova-letra">{LETRAS[j]}</span> {a.texto}
                      {correta && <strong> — correta</strong>}
                      {marcada && !correta && <strong> — sua resposta</strong>}
                      {marcada && correta && <strong> (sua resposta)</strong>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="comparacao-discursiva">
                <div>
                  <h3>Sua resposta</h3>
                  <p className="instrucoes">{item.texto || <em className="texto-suave">Em branco</em>}</p>
                </div>
                <div>
                  <h3>Resposta esperada</h3>
                  <p className="instrucoes">{item.respostaEsperada}</p>
                  {item.criteriosCorrecao && (
                    <>
                      <h3>Critérios de correção</h3>
                      <p className="instrucoes">{item.criteriosCorrecao}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}

      <div className="barra-acoes espaco-acima">
        <button className="botao" type="button" onClick={() => setFase('instrucoes')}>
          Fazer de novo
        </button>
        <Link className="botao botao-secundario" to={`/professor/avaliacoes/${id}`}>
          Voltar para a avaliação
        </Link>
      </div>
    </main>
  );
}
