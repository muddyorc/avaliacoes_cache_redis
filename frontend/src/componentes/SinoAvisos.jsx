// O sino da barra superior: o que o sistema sabe antes do estudante.
//
// Dois avisos, e só eles (decisão do autor em 18/10/2026): uma prova com o prazo
// chegando, e uma nota que acabou de sair. São os dois momentos em que o sistema tem uma
// informação que o estudante só descobriria se resolvesse entrar e olhar.
//
// NÃO EXISTE TABELA DE NOTIFICAÇÃO. Os dois avisos são deduzidos do que a listagem de
// avaliações já devolve — prazo sai da avaliação, nota sai da tentativa. Uma tabela
// obrigaria a gerar linha a cada mudança de estado, com um processo para isso, e a manter
// duas versões da mesma verdade em sincronia. A única lacuna real era saber se o
// estudante já tinha visto a nota, e isso é uma coluna (migração 015).
//
// POR ISSO OS AVISOS SE RESOLVEM SOZINHOS, em vez de serem "dispensados":
//   - o de prazo some quando a prova é entregue ou quando o prazo vence;
//   - o de nota some quando o estudante abre aquele resultado.
// Um botão de dispensar deixaria o aviso de prazo ser calado com a prova ainda por
// fazer — que é justamente quando ele precisa estar lá.
//
// NÃO É TEMPO REAL: a lista é relida a cada navegação. Para "o prazo vence amanhã" e
// "saiu a sua nota", nenhum dos dois muda de minuto em minuto.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { IconeSino } from './Icones.jsx';
import { formatarDataHora, prazoDoEstudante, urgenciaDoPrazo } from '../utils/datas.js';

// Janela do aviso de prazo. Dois dias cobrem "é amanhã" e "é depois de amanhã" sem
// transformar o sino num calendário do semestre inteiro.
const HORAS_DE_ANTECEDENCIA = 48;

// O que ainda depende do estudante: só essas duas situações têm prazo a cumprir.
const PENDENTES = ['DISPONIVEL', 'EM_ANDAMENTO'];

function avisosDe(avaliacoes, agora) {
  const limite = new Date(agora.getTime() + HORAS_DE_ANTECEDENCIA * 3600 * 1000);

  const prazos = avaliacoes
    .filter((a) => PENDENTES.includes(a.situacao))
    .filter((a) => {
      // O prazo DELE: quem está com a prova aberta — ou acabou de recebê-la de volta do
      // professor — tem o tempo da própria tentativa, que pode ser muito menor que o
      // período da avaliação.
      const fim = new Date(prazoDoEstudante(a));
      return fim > agora && fim <= limite;
    })
    .map((a) => ({
      chave: `prazo-${a.id}`,
      tipo: 'prazo',
      avaliacaoId: a.id,
      titulo: a.titulo,
      turma: a.turma?.nome,
      // O mesmo texto do painel do início: a mesma informação não pode ter duas
      // formas em duas telas que o estudante vê na mesma sessão.
      texto: `${urgenciaDoPrazo(prazoDoEstudante(a), agora).texto} · ${formatarDataHora(prazoDoEstudante(a))}`,
      quando: new Date(prazoDoEstudante(a)),
    }));

  const notas = avaliacoes
    .filter((a) => a.resultado && !a.resultado.visualizadoEm)
    .map((a) => ({
      chave: `nota-${a.id}`,
      tipo: 'nota',
      avaliacaoId: a.id,
      titulo: a.titulo,
      turma: a.turma?.nome,
      texto: 'O professor liberou o resultado desta prova',
      quando: new Date(a.dataFim),
    }));

  // Prazo antes de nota: um pede ação, o outro é notícia. Dentro de cada grupo, o mais
  // próximo primeiro.
  return [...prazos.sort((x, y) => x.quando - y.quando), ...notas.sort((x, y) => y.quando - x.quando)];
}

export function SinoAvisos() {
  const [avaliacoes, setAvaliacoes] = useState([]);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef(null);
  const local = useLocation();

  // Relê a cada navegação: é o que faz o aviso sumir logo depois de o estudante entregar
  // a prova ou abrir a nota, em vez de insistir até a página ser recarregada.
  useEffect(() => {
    let ativo = true;
    api('/estudante/avaliacoes')
      .then((d) => ativo && setAvaliacoes(d.avaliacoes))
      // Falha aqui não vira erro na tela: o sino é um extra, e a tela por baixo dele
      // continua funcionando. Sem avisos é o estado normal de quem está em dia.
      .catch(() => ativo && setAvaliacoes([]));
    return () => {
      ativo = false;
    };
  }, [local.pathname]);

  // Fecha ao clicar fora ou com Esc — o comportamento que se espera de um menu, igual ao
  // do avatar, ao lado, e ao dos três pontos dos cartões.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoClicar = (e) => {
      if (!caixa.current?.contains(e.target)) setAberto(false);
    };
    const aoTeclar = (e) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  // Navegar fecha o painel: o destino precisa aparecer inteiro.
  useEffect(() => setAberto(false), [local.pathname]);

  const avisos = useMemo(() => avisosDe(avaliacoes, new Date()), [avaliacoes]);

  return (
    <div className="menu-acoes" ref={caixa}>
      <button
        type="button"
        className="botao-icone sino"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={avisos.length === 0 ? 'Avisos' : `Avisos (${avisos.length})`}
        title="Avisos"
      >
        <IconeSino />
        {/* O número, e não só um ponto: "3 avisos" é uma informação, "há algo" é um
            susto. O `aria-label` do botão já diz o mesmo em palavras, então o contador
            fica escondido do leitor de tela para não ser lido duas vezes. */}
        {avisos.length > 0 && (
          <span className="sino-contador" aria-hidden="true">
            {avisos.length}
          </span>
        )}
      </button>

      {aberto && (
        <div className="menu-flutuante menu-flutuante-fim menu-flutuante-largo" role="menu">
          <div className="menu-cabecalho">
            <p className="sem-margem">
              <strong>Avisos</strong>
            </p>
            <p className="texto-suave sem-margem">
              {avisos.length === 0
                ? 'Nada pedindo atenção agora.'
                : 'Some sozinho quando você resolver — não há o que marcar como lido.'}
            </p>
          </div>

          {avisos.length === 0 ? (
            <p className="texto-suave aviso-vazio">Você está em dia.</p>
          ) : (
            avisos.map((aviso) => (
              <Link
                key={aviso.chave}
                className="menu-item menu-item-aviso"
                role="menuitem"
                to={`/estudante/avaliacoes/${aviso.avaliacaoId}`}
                onClick={() => setAberto(false)}
              >
                <span className={`selo ${aviso.tipo === 'prazo' ? 'selo-alerta' : 'selo-status-publicada'}`}>
                  {aviso.tipo === 'prazo' ? 'Prazo' : 'Nota'}
                </span>
                <span className="menu-item-texto">
                  <strong>{aviso.titulo}</strong>
                  <span className="texto-suave">
                    {aviso.turma ? `${aviso.turma} · ` : ''}
                    {aviso.texto}
                  </span>
                </span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
