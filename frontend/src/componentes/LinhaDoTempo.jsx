// A linha do tempo de uma prova: cada evento que o navegador registrou, na ordem.
//
// Morava dentro da tela de monitoramento. Saiu para cá quando correção e monitoramento
// viraram uma tela só (item 9 do feedback do orientador): os dois lugares que mostram
// eventos — a lista de provas e a tela de corrigir um estudante — precisam da mesma
// linha do tempo, e duas cópias divergiriam na primeira mudança.
//
// É a informação que dá sentido aos números: cinco trocas de aba em dez minutos contam
// uma história diferente de cinco espalhadas por duas horas.
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Aviso } from './Aviso.jsx';
import { Carregando } from './Carregando.jsx';
import { formatarDataHora } from '../utils/datas.js';

export const ROTULO_TIPO = {
  PERDA_FOCO: 'Janela perdeu o foco',
  TROCA_ABA: 'Mudou de aba',
  ATALHO: 'Usou atalho',
  RECURSO_INDISPONIVEL: 'Recurso não disponível no navegador',
  // Registrado, mas fora da contagem do limite (migração 018): sair da tela cheia tem
  // causas inocentes demais para encerrar a prova de alguém.
  SAIU_TELA_CHEIA: 'Saiu da tela cheia',
};

// O aviso do P-06, em um lugar só. Ele acompanha os eventos onde quer que eles apareçam:
// com "12 ocorrências" na mesma linha que "0 pontos", o convite a ligar as duas coisas é
// maior do que era quando as telas eram separadas — então o aviso importa mais, não menos.
export function AvisoDeLeitura() {
  return (
    <p className="texto-suave">
      Estes registros descrevem o que o navegador observou — não afirmam que houve consulta a material externo. A
      janela pode perder o foco por uma notificação, e um atalho pode ser usado dentro da própria prova. Use os
      horários e a sequência como contexto, e converse com o estudante antes de qualquer conclusão.
    </p>
  );
}

// `eventos` pode vir pronto (quem já carregou a prova inteira não precisa de outra
// requisição); sem ele, o componente busca sozinho.
export function LinhaDoTempo({ avaliacaoId, tentativaId, eventos = null, estudante = '' }) {
  const [dados, setDados] = useState(eventos ? { eventos, estudante } : null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (eventos) return undefined;
    let ativo = true;
    api(`/monitoramento/${avaliacaoId}/tentativas/${tentativaId}`)
      .then((r) => ativo && setDados(r))
      .catch((f) => ativo && setErro(f.message));
    return () => {
      ativo = false;
    };
  }, [avaliacaoId, tentativaId, eventos]);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return <Carregando mensagem="Carregando os eventos…" />;

  // As devoluções vêm antes dos eventos, e não misturadas a eles: são ato do PROFESSOR,
  // enquanto a tabela abaixo registra o que o navegador do estudante observou. Juntar as
  // duas coisas numa lista só faria parecer que a reabertura é mais um evento da prova.
  //
  // E elas importam para ler o resto: cinco ocorrências antes de uma devolução e cinco
  // depois contam histórias diferentes — só as de depois contam para o limite.
  const devolucoes = dados.reaberturas ?? [];

  const registro = devolucoes.length > 0 && (
    <ul className="lista-simples espaco-abaixo">
      {devolucoes.map((r) => (
        <li key={r.reabertaEm}>
          <strong>Prova devolvida</strong> em {formatarDataHora(r.reabertaEm)} por {r.professor}, com {r.minutos}{' '}
          {r.minutos === 1 ? 'minuto' : 'minutos'}. Motivo: {r.motivo}
        </li>
      ))}
    </ul>
  );

  if (dados.eventos.length === 0) {
    return (
      <>
        {registro}
        <p className="texto-suave sem-margem">Nenhum evento registrado nesta prova.</p>
      </>
    );
  }

  return (
    <>
    {registro}
    <div className="tabela-rolavel">
      <table className="tabela">
        <caption className="apenas-leitor">Eventos registrados durante a prova de {dados.estudante}</caption>
        <thead>
          <tr>
            <th scope="col">Quando</th>
            <th scope="col">Evento</th>
            <th scope="col">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {dados.eventos.map((e) => (
            <tr key={e.id}>
              <td>{formatarDataHora(e.dataHora)}</td>
              <td>
                {ROTULO_TIPO[e.tipo] ?? e.tipo}
                {e.bloqueou && <span className="etiqueta etiqueta-alerta"> encerrou a prova</span>}
              </td>
              <td>{e.detalhe || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
