// UC08 — o estudante realiza a avaliação; UC09 — salvamento automático.
//
// Pontos que o DERS determina e que a tela respeita:
//   - o tempo é do SERVIDOR (DT06): o cronômetro se orienta pela diferença entre a hora
//     do servidor e a do navegador, e quem encerra de fato é o backend;
//   - as respostas são salvas periodicamente, com indicação visual (UC09);
//   - falha de salvamento mantém as respostas na sessão e tenta de novo (UC09 A1);
//   - queda de conexão sincroniza o pendente quando a conexão volta (UC09 A2);
//   - finalizar pede confirmação (UC08, passo 13);
//   - ao esgotar o tempo, a prova é entregue com o que estava salvo (UC08 A4);
//   - durante a prova, os eventos que o navegador expõe são relatados ao servidor
//     (RF10, UC10) e, se a avaliação tiver limite de ocorrências, é o servidor quem
//     encerra a tentativa — a tela apenas obedece.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { Dialogo } from '../componentes/Dialogo.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { QuestaoResposta } from '../componentes/QuestaoResposta.jsx';
import { ResultadoDaProva } from '../componentes/ResultadoDaProva.jsx';
import { formatarDataHora, formatarDuracao, formatarPontos } from '../utils/datas.js';
import { iniciarMonitoramento } from '../utils/monitoramento.js';
import { pedirTelaCheia, sairDaTelaCheia } from '../utils/telaCheia.js';

const INTERVALO_SALVAMENTO = 10000; // UC09: "em intervalo definido pelo sistema"

function formatarRelogio(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dois = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}

export function RealizarAvaliacao() {
  const { id } = useParams();

  // De onde o estudante veio. A prova tem três portas de entrada — a turma, o início e a
  // lista de avaliações — e com um destino fixo o "Voltar" levava duas delas para uma
  // tela que a pessoa não tinha aberto. Mesmo ajuste que as telas do professor já têm.
  //
  // A origem viaja na URL, e não no histórico do navegador: `navigate(-1)` não tem para
  // onde ir quando se abre o endereço direto ou se recarrega a página — e numa prova,
  // recarregar é justamente o que acontece.
  const [parametros] = useSearchParams();
  const turmaDeOrigem = parametros.get('turma');
  const voltarPara = turmaDeOrigem
    ? `/estudante/turmas/${turmaDeOrigem}`
    : parametros.get('de') === 'inicio'
      ? '/estudante'
      : '/estudante/avaliacoes';
  const rotuloVoltar = turmaDeOrigem
    ? 'Voltar para a turma'
    : parametros.get('de') === 'inicio'
      ? 'Voltar para o início'
      : 'Voltar para as avaliações';
  const navegar = useNavigate();

  const [avaliacao, setAvaliacao] = useState(null);
  const [questoes, setQuestoes] = useState([]);
  const [respostas, setRespostas] = useState({});
  const [travadas, setTravadas] = useState(new Set());
  const [fase, setFase] = useState('carregando'); // carregando | instrucoes | respondendo | encerrada
  const [erro, setErro] = useState('');
  const [encerramento, setEncerramento] = useState(null);
  // Qual confirmação está aberta: 'iniciar', 'entregar' ou nenhuma.
  const [confirmando, setConfirmando] = useState(null);
  // Estado do monitoramento vindo do servidor: quantas ocorrências já contam e qual é o
  // limite, quando existe. A tela só mostra — quem conta é o servidor.
  const [monitoramento, setMonitoramento] = useState(null);

  const [restante, setRestante] = useState(0);
  const [salvoEm, setSalvoEm] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [falhaSalvamento, setFalhaSalvamento] = useState(false);

  // Refs para o que o cronômetro e o salvamento periódico precisam ler sem reiniciar:
  const diferencaRelogio = useRef(0); // hora do servidor menos hora do navegador
  const prazoRef = useRef(0);
  const pendentesRef = useRef(new Set()); // questões alteradas ainda não salvas
  const respostasRef = useRef({});
  const entregandoRef = useRef(false);

  respostasRef.current = respostas;
  // Quais questões o servidor já fechou. Fica fora de `respostas` de propósito: aquele
  // objeto é o CORPO que vai para a API a cada salvamento, e carregar um campo de
  // controle junto com as respostas acabaria enviando-o ao servidor.
  const travadasRef = useRef(new Set());

  const aplicarEstado = useCallback((dados) => {
    setAvaliacao(dados.avaliacao);
    setQuestoes(dados.questoes ?? []);
    const mapa = {};
    const fechadas = new Set();
    for (const r of dados.respostas ?? []) {
      // Respondida antes de o estudante sair da prova (migrações 016 e 017).
      if (r.travada) fechadas.add(r.questaoId);
      // P-26: a questão de múltipla escolha chega como lista. Lista vazia é resposta
      // válida ("desmarquei tudo"), então o que distingue é a presença do campo.
      if (r.alternativaIds?.length) mapa[r.questaoId] = { alternativaIds: r.alternativaIds };
      else if (r.alternativaId != null) mapa[r.questaoId] = { alternativaId: r.alternativaId };
      else mapa[r.questaoId] = { texto: r.texto ?? '' };
    }
    setRespostas(mapa);
    respostasRef.current = mapa;
    setTravadas(fechadas);
    travadasRef.current = fechadas;
    pendentesRef.current = new Set();
    if (dados.horaServidor) diferencaRelogio.current = new Date(dados.horaServidor).getTime() - Date.now();
    if (dados.avaliacao.tentativa?.prazoFinal) prazoRef.current = new Date(dados.avaliacao.tentativa.prazoFinal).getTime();
  }, []);

  // Abertura: se já existe tentativa em andamento, retoma direto (UC09 A2).
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const { avaliacao: a } = await api(`/estudante/avaliacoes/${id}`);
        if (!ativo) return;
        if (a.situacao === 'EM_ANDAMENTO') {
          aplicarEstado(await api(`/estudante/avaliacoes/${id}/tentativa`));
          setFase('respondendo');
          return;
        }
        setAvaliacao(a);
        if (['FINALIZADA', 'TEMPO_ESGOTADO', 'BLOQUEADA', 'NAO_REALIZADA'].includes(a.situacao)) {
          setEncerramento({ situacao: a.situacao, finalizadaEm: a.tentativa?.finalizadaEm });
          setFase('encerrada');
          return;
        }
        setFase('instrucoes');
      } catch (falha) {
        if (ativo) {
          setErro(falha.message);
          setFase('instrucoes');
        }
      }
    })();
    return () => {
      ativo = false;
    };
  }, [id, aplicarEstado]);

  // Envia ao servidor as questões alteradas desde o último salvamento.
  const salvar = useCallback(
    async ({ forcar = false } = {}) => {
      // "Salvar agora" reenvia tudo o que está respondido; o ciclo automático manda só
      // o que mudou desde o último salvamento.
      const todas = forcar ? Object.keys(respostasRef.current) : [...pendentesRef.current];
      // As travadas nunca são enviadas. Sem este filtro, o "Salvar agora" — que reenvia
      // TUDO — levaria sempre uma resposta fechada junto e tomaria 409 do servidor,
      // mesmo com o estudante respondendo só o que pode.
      const pendentes = todas.filter((questaoId) => !travadasRef.current.has(Number(questaoId)));
      if (pendentes.length === 0) return true;
      const lista = pendentes.map((questaoId) => ({ questaoId: Number(questaoId), ...respostasRef.current[questaoId] }));

      setSalvando(true);
      try {
        const r = await api(`/estudante/avaliacoes/${id}/respostas`, { metodo: 'PUT', corpo: { respostas: lista } });
        // Só limpa o que foi efetivamente enviado: o que o estudante digitou durante a
        // requisição continua pendente para o próximo ciclo.
        for (const questaoId of pendentes) pendentesRef.current.delete(questaoId);
        setSalvoEm(r.salvoEm);
        setFalhaSalvamento(false);
        return true;
      } catch (falha) {
        // UC09 A1/A2: mantém as respostas na sessão e tenta de novo no próximo ciclo.
        //
        // `campos.situacao` é o que distingue os dois 409 possíveis aqui. O do prazo
        // vencido traz a situação da tentativa e significa que a prova acabou; o da
        // resposta fechada (migrações 016 e 017) não traz, e a prova continua. Tratar
        // os dois como fim fazia a tela anunciar "Tempo encerrado" no meio da prova,
        // com o relógio ainda correndo.
        if (falha.status === 409 && falha.campos?.situacao) {
          setEncerramento({ situacao: falha.campos.situacao });
          setFase('encerrada');
          return false;
        }
        if (falha.status === 409) {
          setErro(falha.message);
          return false;
        }
        setFalhaSalvamento(true);
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [id],
  );

  const entregar = useCallback(
    async (porTempo = false) => {
      if (entregandoRef.current) return;
      entregandoRef.current = true;
      setErro('');
      try {
        const pendentes = [...pendentesRef.current].map((questaoId) => ({
          questaoId: Number(questaoId),
          ...respostasRef.current[questaoId],
        }));
        const r = await api(`/estudante/avaliacoes/${id}/finalizar`, { metodo: 'POST', corpo: { respostas: pendentes } });
        pendentesRef.current = new Set();
        setEncerramento({ ...r, porTempo });
        setFase('encerrada');
        window.scrollTo(0, 0);
      } catch (falha) {
        setErro(falha.message);
      } finally {
        entregandoRef.current = false;
      }
    },
    [id],
  );

  // Cronômetro + salvamento periódico no mesmo tique de 1 s.
  useEffect(() => {
    if (fase !== 'respondendo') return undefined;
    let desdeUltimoSalvamento = 0;

    const intervalo = setInterval(() => {
      const agoraServidor = Date.now() + diferencaRelogio.current;
      const falta = prazoRef.current - agoraServidor;
      setRestante(falta);

      if (falta <= 0) {
        clearInterval(intervalo);
        entregar(true); // UC08 A4
        return;
      }
      desdeUltimoSalvamento += 1000;
      if (desdeUltimoSalvamento >= INTERVALO_SALVAMENTO) {
        desdeUltimoSalvamento = 0;
        salvar();
      }
    }, 1000);

    return () => clearInterval(intervalo);
  }, [fase, salvar, entregar]);

  // RF10 / UC10 — monitoramento da integridade.
  //
  // Só é ligado enquanto a prova está sendo respondida e apenas quando o professor o
  // deixou ativo na avaliação (P-06). O que a página observa é o que o navegador expõe;
  // o servidor decide se alguma regra foi violada.
  useEffect(() => {
    if (fase !== 'respondendo' || !avaliacao?.monitoramentoAtivo) return undefined;

    const encerrarMonitoramento = iniciarMonitoramento({
      enviar: async (eventos) => {
        const estado = await api(`/estudante/avaliacoes/${id}/eventos`, {
          metodo: 'POST',
          corpo: { eventos },
        });
        setMonitoramento(estado);
        return estado;
      },
      aoBloquear: (estado) => {
        // O servidor encerrou a tentativa: a tela passa para o estado final com o motivo,
        // sem tentar salvar mais nada — as respostas já salvas foram preservadas.
        setEncerramento({ situacao: 'BLOQUEADA', motivo: estado.motivo });
        setMonitoramento(estado);
        setFase('encerrada');
        window.scrollTo(0, 0);
      },
    });

    return encerrarMonitoramento;
  }, [fase, id, avaliacao?.monitoramentoAtivo]);

  // Acabou a prova, acabou a tela cheia.
  //
  // O efeito roda DEPOIS das limpezas dos efeitos anteriores — é assim que o React
  // encadeia —, e a do monitoramento é uma delas. Isso importa: se a saída acontecesse
  // antes, o `fullscreenchange` seria registrado como "saiu da tela cheia" e o professor
  // veria uma ocorrência que o estudante não provocou.
  //
  // A limpeza cobre quem sai da prova pelo botão do navegador, sem entregar.
  // Acabou a prova: sai da tela cheia. Só em "encerrada" — na montagem a fase ainda é
  // "carregando", e sair ali desfazia a tela cheia que o clique em "Continuar" tinha
  // acabado de pedir.
  useEffect(() => {
    if (fase === 'encerrada') sairDaTelaCheia();
  }, [fase]);

  // Saiu da prova sem entregar (botão do navegador, por exemplo): a tela cheia também
  // termina. Efeito SEM dependências, de propósito: com `[fase]`, a limpeza rodaria a
  // cada troca de fase, e a passagem de "carregando" para "respondendo" derrubava a
  // tela cheia menos de um segundo depois de ela abrir.
  useEffect(() => sairDaTelaCheia, []);

  // UC09 A2: ao voltar a conexão, sincroniza o que ficou pendente.
  useEffect(() => {
    if (fase !== 'respondendo') return undefined;
    const aoVoltar = () => salvar();
    window.addEventListener('online', aoVoltar);
    return () => window.removeEventListener('online', aoVoltar);
  }, [fase, salvar]);

  // Avisa se houver resposta ainda não salva ao fechar a aba.
  useEffect(() => {
    if (fase !== 'respondendo') return undefined;
    const avisar = (e) => {
      if (pendentesRef.current.size === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [fase]);

  async function iniciar() {
    setConfirmando(null);
    // Antes da requisição: o gesto do clique ainda vale aqui, e esperar a resposta do
    // servidor faria o navegador recusar o pedido por falta de interação recente.
    pedirTelaCheia();
    setErro('');
    try {
      aplicarEstado(await api(`/estudante/avaliacoes/${id}/iniciar`, { metodo: 'POST' }));
      setFase('respondendo');
      window.scrollTo(0, 0);
    } catch (falha) {
      setErro(falha.message);
    }
  }

  function responder(questaoId, valor) {
    setRespostas((atual) => {
      const novo = { ...atual, [questaoId]: valor };
      respostasRef.current = novo;
      return novo;
    });
    pendentesRef.current.add(String(questaoId));
  }

  // Quantas ficaram sem resposta, para a confirmação de entrega poder avisar.
  function semResposta() {
    const respondidas = questoes.filter((q) => {
      const r = respostas[q.questaoId];
      return r && (r.alternativaId != null || r.alternativaIds?.length > 0 || r.texto?.trim());
    }).length;
    return questoes.length - respondidas;
  }

  if (fase === 'carregando') {
    return (
      <Layout titulo="Avaliação">
        <div className="conteudo-central">
        <Carregando mensagem="Abrindo a avaliação…" />
        </div>
      </Layout>
    );
  }

  if (!avaliacao) {
    return (
      <Layout titulo="Avaliação">
        <div className="conteudo-central">
        <Aviso tipo="erro">{erro || 'Avaliação não encontrada.'}</Aviso>
        <Link to={voltarPara}>{rotuloVoltar}</Link>
        </div>
      </Layout>
    );
  }

  // ------------------------------------------------------------------ instruções
  if (fase === 'instrucoes') {
    const indisponivel = avaliacao.situacao !== 'DISPONIVEL';
    return (
      <Layout>
        <div className="conteudo-central">
        <header className="cabecalho">
          <h1>{avaliacao.titulo}</h1>
        </header>
        {/* O impedimento vem ANTES de tudo: ele muda o que esta tela significa. Embaixo,
            colado no botão desligado, parecia mais um parágrafo entre outros. */}
        {indisponivel && (
          <div className="aviso aviso-alerta" role="status">
            {avaliacao.situacao === 'AGENDADA'
              ? `Esta avaliação abre em ${formatarDataHora(avaliacao.dataInicio)}.`
              : 'Esta avaliação não está disponível para realização.'}
          </div>
        )}

        <section className="painel">
          <Aviso tipo="erro">{erro}</Aviso>

          {/* Só quando existem: "Sem instruções adicionais" era uma linha que ocupava
              espaço para dizer que não havia o que dizer. */}
          {avaliacao.descricao && (
            <>
              <h2 className="cartao-titulo">Instruções do professor</h2>
              <p className="instrucoes">{avaliacao.descricao}</p>
            </>
          )}

          {/* Fatos independentes que estavam num parágrafo corrido. Em ficha, o estudante
              acha cada um de relance — que é como se lê uma tela antes de começar a
              prova. Mesmo formato da tela de entrega, a pedido do autor (17/10/2026).
              As ressalvas e o detalhe do monitoramento saíram daqui: passaram para a
              confirmação do botão Iniciar, onde precisam ser dispensadas. */}
          <dl className="ficha">
            <div>
              <dt>Disponível de</dt>
              <dd>{formatarDataHora(avaliacao.dataInicio)}</dd>
            </div>
            <div>
              <dt>Prazo</dt>
              <dd>{formatarDataHora(avaliacao.dataFim)}</dd>
            </div>
            <div>
              <dt>Tempo</dt>
              <dd>{formatarDuracao(avaliacao.duracaoMinutos)}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd>{formatarPontos(avaliacao.pontuacaoTotal)}</dd>
            </div>
            <div>
              <dt>Questões</dt>
              <dd>{avaliacao.totalQuestoes}</dd>
            </div>
            <div>
              <dt>Tentativas</dt>
              <dd>Uma</dd>
            </div>
            {/* O fato fica na ficha; o detalhe do que é registrado vai na confirmação,
                onde o estudante tem de dispensá-lo para começar. Esconder que a prova é
                monitorada até o clique seria o contrário do que o RF10 pede. */}
            {avaliacao.monitoramentoAtivo && (
              <div>
                <dt>Monitoramento</dt>
                <dd>Ativo durante a prova</dd>
              </div>
            )}
          </dl>

          <div className="barra-acoes">
            <button
              className="botao"
              type="button"
              disabled={indisponivel}
              onClick={() => setConfirmando('iniciar')}
            >
              Iniciar avaliação
            </button>
            {/* O rótulo nomeia o destino: "Voltar" sozinho faz o estudante adivinhar. */}
            <Link className="botao botao-secundario" to={voltarPara}>
              {rotuloVoltar}
            </Link>
          </div>
        </section>

        {/* RF10: o estudante sabe o que é registrado ANTES de começar — a exigência
            continua cumprida, e no momento em que a informação importa. Na tela, esses
            avisos viravam parede de texto que se lê no automático; aqui ele precisa
            responder para seguir. */}
        <Dialogo
          aberto={confirmando === 'iniciar'}
          titulo="Iniciar a avaliação?"
          confirmar="Iniciar agora"
          cancelar="Ainda não"
          aoConfirmar={iniciar}
          aoCancelar={() => setConfirmando(null)}
        >
          {/* Três linhas, valores curtos. As ressalvas que antes ocupavam uma frase
              inteira cada — "a contagem não para", "não é possível refazer" — viraram
              meia linha: o que importa é o fato, não a explicação dele. */}
          <dl className="ficha">
            <div>
              <dt>Tempo</dt>
              <dd>{formatarDuracao(avaliacao.duracaoMinutos)} minutos, sem pausa</dd>
            </div>
            <div>
              <dt>Tentativas</dt>
              <dd>Uma, sem refazer</dd>
            </div>
            <div>
              <dt>Tela</dt>
              <dd>Cheia, durante a prova</dd>
            </div>
          </dl>

          {/* RF10 e P-06: o estudante sabe O QUE é registrado antes de começar. A lista
              fica — é ela que separa monitoramento de vigilância, e sem ela a prova
              observaria às escondidas. O que saiu foi a explicação de COMO sair da tela
              cheia: avisar isso é ensinar a sair, e o Esc é comportamento conhecido de
              qualquer navegador. A saída em si continua listada, porque é registrada. */}
          {avaliacao.monitoramentoAtivo && (
            <div className="bloco-monitoramento">
              <h3 className="cartao-titulo">O que fica registrado</h3>
              <ul className="lista-simples">
                <li>Perda de foco da janela e troca de aba</li>
                <li>Saída da tela cheia</li>
                <li>Atalhos como copiar, colar e imprimir</li>
              </ul>
              <p className="texto-suave sem-margem">
                O sistema não vê a sua tela.
                {avaliacao.limiteOcorrencias
                  ? ` Na ${avaliacao.limiteOcorrencias}ª ocorrência a prova é encerrada, com o que estiver salvo.`
                  : ' O registro é para o professor; nada encerra a prova.'}
              </p>
            </div>
          )}
        </Dialogo>
        </div>
      </Layout>
    );
  }

  // ------------------------------------------------------------------- encerrada
  if (fase === 'encerrada') {
    const porTempo = encerramento?.situacao === 'TEMPO_ESGOTADO';
    // Prova que o prazo encerrou sem ela ser aberta (migração 014). Não é entrega nem
    // tempo esgotado, e o texto precisa dizer isso — senão o aluno lê "entregue" sobre
    // algo que ele não fez.
    const naoRealizada = encerramento?.situacao === 'NAO_REALIZADA';
    // UC10 A4: encerrada pelo limite de ocorrências do monitoramento.
    const porMonitoramento =
      encerramento?.situacao === 'BLOQUEADA' || avaliacao.tentativa?.motivoBloqueio;
    const motivo = encerramento?.motivo || avaliacao.tentativa?.motivoBloqueio;
    const titulo = naoRealizada
      ? 'Avaliação não realizada'
      : porMonitoramento
        ? 'Avaliação encerrada'
        : porTempo
          ? 'Tempo encerrado'
          : 'Avaliação entregue';
    // `encerramento` só existe na entrega que acabou de acontecer; quem volta a esta tela
    // depois (e é para cá que o resultado é consultado) tem o horário na própria
    // tentativa. Sem o segundo, a linha sumia justo na visita de quem veio ver a nota.
    const encerradaEm = encerramento?.finalizadaEm ?? avaliacao.tentativa?.finalizadaEm;
    return (
      <Layout>
        <div className="conteudo-central">
        <header className="cabecalho">
          <h1>{titulo}</h1>
          <p>{avaliacao.titulo}</p>
        </header>
        <section className="painel">
          <Aviso tipo={naoRealizada || porTempo || porMonitoramento ? 'erro' : 'sucesso'}>
            {naoRealizada
              ? 'O prazo desta avaliação terminou e ela não foi realizada. A prova foi registrada em branco, com nota zero. Procure o professor se houve algum impedimento.'
              : porMonitoramento
              ? `${motivo} As respostas salvas até aqui foram registradas e serão corrigidas normalmente. Procure o professor se quiser conversar sobre o ocorrido.`
                : porTempo
                  ? 'O tempo terminou e a avaliação foi encerrada. As respostas salvas até aqui foram registradas.'
                  : 'Sua avaliação foi entregue e as respostas estão registradas.'}
          </Aviso>

          {/* A mesma ficha da tela de instruções, agora no passado. Enquanto o professor
              não libera a nota, esta tela não tinha o que mostrar além do aviso de
              entrega — e estes quatro fatos são justamente o que o estudante quer
              conferir depois de entregar: que horas entregou, até quando ia o prazo,
              quanto tempo tinha e quanto valia a prova. */}
          <dl className="ficha">
            <div>
              <dt>{naoRealizada ? 'Prazo encerrado em' : porTempo || porMonitoramento ? 'Encerrada em' : 'Entregue em'}</dt>
              <dd>{encerradaEm ? formatarDataHora(encerradaEm) : '—'}</dd>
            </div>
            {/* Quando a prova não foi realizada, a linha de cima já é o prazo: repeti-lo
                aqui seria a mesma data duas vezes seguidas. */}
            {!naoRealizada && (
              <div>
                <dt>Prazo</dt>
                <dd>{formatarDataHora(avaliacao.dataFim)}</dd>
              </div>
            )}
            <div>
              <dt>Tempo</dt>
              <dd>{formatarDuracao(avaliacao.duracaoMinutos)}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd>{formatarPontos(avaliacao.pontuacaoTotal)}</dd>
            </div>
            <div>
              <dt>Questões</dt>
              <dd>{avaliacao.totalQuestoes}</dd>
            </div>
          </dl>

          <div className="barra-acoes">
            <button className="botao botao-secundario" type="button" onClick={() => navegar(voltarPara)}>
              {rotuloVoltar}
            </button>
          </div>
        </section>

        {/* RF13 estendido: é aqui que o estudante volta para ver o resultado. O que
            aparece — nota, gabarito, comparação com a turma — é o que o professor
            liberou; enquanto não houver liberação, o componente explica o porquê. */}
        <ResultadoDaProva avaliacaoId={id} />
        </div>
      </Layout>
    );
  }

  // ----------------------------------------------------------------- respondendo
  //
  // Única tela do estudante SEM o menu lateral, e de propósito: durante a prova, uma
  // lista de links é um convite a sair dela — e sair é exatamente o que o monitoramento
  // registra (RF10). A barra da prova, com título e cronômetro, é o cabeçalho daqui.
  const poucoTempo = restante <= 5 * 60000;
  return (
    <main className="pagina">
      <div className="barra-prova">
        <h1 className="barra-prova-titulo">{avaliacao.titulo}</h1>
        <p className={`cronometro${poucoTempo ? ' cronometro-alerta' : ''}`} role="timer" aria-live="off">
          <span className="apenas-leitor">Tempo restante: </span>
          {formatarRelogio(restante)}
        </p>
        {/* Sem botão de voltar à tela cheia, a pedido do autor (18/10/2026): quem saiu
            saiu por querer, e oferecer o caminho de volta só ocuparia a barra. O que
            importa está registrado — a saída aparece na linha do tempo do professor. */}
      </div>

      {/* O estudante acompanha a própria contagem: saber onde está é o que torna o
          limite justo. Só aparece quando há limite e quando já houve ocorrência. */}
      {monitoramento?.monitorada && monitoramento.limite > 0 && monitoramento.ocorrencias > 0 && (
        <p className="estado-monitoramento" role="status">
          Ocorrências registradas: {monitoramento.ocorrencias} de {monitoramento.limite}.
        </p>
      )}

      {/* UC09, passo 7: indicação visual do salvamento. */}
      <p className={`estado-salvamento${falhaSalvamento ? ' estado-salvamento-falha' : ''}`} role="status">
        {falhaSalvamento
          ? 'Sem conexão com o servidor. Suas respostas estão guardadas aqui e serão enviadas assim que a conexão voltar.'
          : salvando
            ? 'Salvando…'
            : salvoEm
              ? `Respostas salvas às ${formatarDataHora(salvoEm).split(', ')[1] ?? formatarDataHora(salvoEm)}`
              : 'As respostas são salvas automaticamente.'}
      </p>

      <Aviso tipo="erro">{erro}</Aviso>

      {questoes.map((q, i) => (
        <QuestaoResposta
          key={q.questaoId}
          // Respondida antes de o estudante sair da prova: fica visível, mas fechada.
          travada={travadas.has(q.questaoId)}
          questao={q}
          numero={i + 1}
          resposta={respostas[q.questaoId]}
          aoResponder={(valor) => responder(q.questaoId, valor)}
        />
      ))}

      <div className="barra-acoes">
        <button className="botao" type="button" onClick={() => setConfirmando('entregar')}>
          Entregar avaliação
        </button>
        <button className="botao botao-secundario" type="button" disabled={salvando} onClick={() => salvar({ forcar: true })}>
          Salvar agora
        </button>
      </div>

      {/* A entrega é sem volta, e a caixa diz o que falta antes de ser tarde: o número
          de questões em branco é a informação que muda a decisão. */}
      <Dialogo
        aberto={confirmando === 'entregar'}
        titulo="Entregar a avaliação?"
        confirmar="Entregar"
        cancelar="Continuar respondendo"
        aoConfirmar={() => {
          setConfirmando(null);
          entregar(false);
        }}
        aoCancelar={() => setConfirmando(null)}
      >
        <p>Depois de entregar, não será possível alterar as respostas.</p>
        {semResposta() > 0 && (
          <p className="cartao-aviso">
            {semResposta() === 1
              ? 'Há 1 questão sem resposta.'
              : `Há ${semResposta()} questões sem resposta.`}{' '}
            Elas valerão zero.
          </p>
        )}
      </Dialogo>
    </main>
  );
}
