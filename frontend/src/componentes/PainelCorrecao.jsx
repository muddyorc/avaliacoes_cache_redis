// Correção e monitoramento numa tabela só (item 9 do feedback do orientador).
//
// Eram duas telas, e a sobreposição era total: as mesmas linhas — um estudante por prova,
// na mesma ordem — com colunas diferentes. Uma mostrava Objetivas/Discursivas/Nota, a
// outra Ocorrências/Foco/Abas/Atalhos. Não é fundir duas funcionalidades; é parar de
// quebrar uma tabela em duas páginas.
//
// O ganho concreto: ao decidir a nota de uma discursiva, o professor vê na mesma linha o
// que o navegador registrou naquela prova. Antes precisava abrir a outra tela e cruzar
// pelo nome.
//
// E é justamente por isso que o aviso do P-06 (`AvisoDeLeitura`) ficou MAIS necessário:
// com "12 ocorrências" ao lado de "0 pontos", o convite a ligar as duas coisas cresce. O
// sistema não correlaciona os dois números sozinho, e a tela precisa dizer isso.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Aviso } from './Aviso.jsx';
import { Campo } from './Campo.jsx';
import { Dialogo } from './Dialogo.jsx';
import { Carregando } from './Carregando.jsx';
import { AvisoDeLeitura, LinhaDoTempo } from './LinhaDoTempo.jsx';
import { formatarDataHora, formatarPontos } from '../utils/datas.js';

const SITUACAO_PROVA = {
  EM_ANDAMENTO: 'Em andamento',
  FINALIZADA: 'Entregue',
  TEMPO_ESGOTADO: 'Encerrada por tempo',
  BLOQUEADA: 'Encerrada pelo monitoramento',
  // O estudante não abriu a prova dentro do prazo. Não é "tempo esgotado": esse é de
  // quem começou e não terminou, e a diferença importa para quem vai dar a nota.
  NAO_REALIZADA: 'Não realizada',
};

export function PainelCorrecao({ avaliacaoId }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [liberando, setLiberando] = useState(false);
  // Qual linha está com a linha do tempo aberta. Uma por vez: abrir várias empurraria a
  // tabela para fora da tela e tiraria justamente a comparação que a lista serve.
  const [aberta, setAberta] = useState(null);
  // Qual prova está sendo devolvida: a tentativa escolhida, 'turma' para todas, ou nada.
  const [reabrindo, setReabrindo] = useState(null);
  const [minutos, setMinutos] = useState('30');
  // Trava de clique duplo: sem ela, o professor devolvia a mesma prova várias vezes
  // seguidas — cada clique somando tempo e uma linha no histórico.
  const [devolvendo, setDevolvendo] = useState(false);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    try {
      setDados(await api(`/correcao/${avaliacaoId}`));
    } catch (falha) {
      setErro(falha.message);
    }
  }, [avaliacaoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function liberar() {
    if (!window.confirm('Liberar os resultados? Os estudantes passarão a ver a nota desta avaliação.')) return;
    setLiberando(true);
    setErro('');
    setMensagem('');
    try {
      setDados(await api(`/correcao/${avaliacaoId}/liberar`, { metodo: 'POST' }));
      setMensagem('Resultados liberados. Os estudantes já podem ver a nota.');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setLiberando(false);
    }
  }

  // Devolver a prova é exceção, e exceção precisa de justificativa escrita: é o que o
  // professor terá para mostrar se alguém perguntar por que aquela prova foi reaberta.
  async function confirmarReabertura() {
    if (devolvendo) return;
    const alvo = reabrindo;
    setReabrindo(null);
    setDevolvendo(true);
    setErro('');
    setMensagem('');
    try {
      const caminho =
        alvo === 'turma'
          ? `/correcao/${avaliacaoId}/reabrir`
          : `/correcao/${avaliacaoId}/tentativas/${alvo}/reabrir`;
      setDados(await api(caminho, { metodo: 'POST', corpo: { minutos: Number(minutos), motivo } }));
      setMensagem(
        alvo === 'turma'
          ? 'Provas devolvidas à turma, com tempo novo.'
          : 'Prova devolvida ao estudante, com tempo novo.',
      );
      setMotivo('');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setDevolvendo(false);
    }
  }

  if (!dados && !erro) return <Carregando mensagem="Abrindo a correção…" />;
  if (erro && !dados) return <Aviso tipo="erro">{erro}</Aviso>;

  const { avaliacao, resumo, tentativas } = dados;
  // Só vale mostrar a coluna de ocorrências onde o monitoramento esteve ligado: numa
  // prova sem monitoramento, uma coluna de zeros sugeriria que ninguém fez nada de
  // errado, quando na verdade nada foi observado.
  const temMonitoramento = avaliacao.monitoramentoAtivo && tentativas.some((t) => t.ocorrencias > 0);

  return (
    <>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {mensagem && <Aviso tipo="sucesso">{mensagem}</Aviso>}

      <section className="cartao">
        <h2>Correção</h2>
        <div className="placar">
          <div>
            <p className="placar-numero">{resumo.total}</p>
            <p className="texto-suave sem-margem">provas</p>
          </div>
          <div>
            <p className="placar-numero">{resumo.aguardandoCorrecao}</p>
            <p className="texto-suave sem-margem">aguardando correção</p>
          </div>
          <div>
            <p className="placar-numero">{resumo.corrigidas}</p>
            <p className="texto-suave sem-margem">corrigidas</p>
          </div>
          {resumo.emAndamento > 0 && (
            <div>
              <p className="placar-numero">{resumo.emAndamento}</p>
              <p className="texto-suave sem-margem">ainda fazendo</p>
            </div>
          )}
        </div>

        <p className="texto-suave espaco-acima-pequeno">
          As questões objetivas são corrigidas automaticamente pelo sistema. Você dá a nota das discursivas.
        </p>

        {avaliacao.resultadosLiberados ? (
          <p className="etiqueta-ok">Resultados liberados: os estudantes já veem a nota.</p>
        ) : (
          <div className="bloco-teste">
            <div>
              <p className="sem-margem">
                <strong>Liberar resultados</strong>
              </p>
              <p className="texto-suave sem-margem">
                {resumo.podeLiberar
                  ? 'Tudo corrigido. Ao liberar, cada estudante passa a ver a própria nota.'
                  : 'Disponível quando todas as provas estiverem encerradas e corrigidas.'}
              </p>
            </div>
            <button className="botao" type="button" disabled={!resumo.podeLiberar || liberando} onClick={liberar}>
              {liberando ? 'Liberando…' : 'Liberar resultados'}
            </button>
          </div>
        )}

        {/* O caminho de volta. Liberar a nota é decidido aqui; o que mais o estudante vê
            é decidido em Configurações, e sem este aviso o professor só descobriria isso
            por acaso — era o que acontecia quando as duas coisas ficavam na mesma caixa,
            naquela aba que ninguém abria. */}
        <p className="texto-suave espaco-acima-pequeno">
          Além da nota, o estudante vê o que estiver marcado em{' '}
          <Link to={`/professor/avaliacoes/${avaliacaoId}?aba=configuracoes`}>
            Configurações › Visibilidade dos resultados
          </Link>
          .
        </p>
      </section>

      <section className="cartao espaco-acima">
        <h3 className="cartao-titulo">Provas</h3>
        {tentativas.length === 0 ? (
          <p className="texto-suave">Nenhum estudante realizou esta avaliação ainda.</p>
        ) : (
          <>
            {temMonitoramento && <AvisoDeLeitura />}
            <div className="tabela-rolavel">
              <table className="tabela">
                <caption className="apenas-leitor">
                  Provas realizadas, situação da correção e ocorrências registradas
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Estudante</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Objetivas</th>
                    <th scope="col">Discursivas</th>
                    <th scope="col">Nota</th>
                    {avaliacao.monitoramentoAtivo && <th scope="col">Ocorrências</th>}
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {tentativas.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {t.estudante.nome}
                        <p className="texto-suave sem-margem quebra">{t.estudante.email}</p>
                      </td>
                      <td>
                        {SITUACAO_PROVA[t.status] ?? t.status}
                        {t.finalizadaEm && <p className="texto-suave sem-margem">{formatarDataHora(t.finalizadaEm)}</p>}
                        {/* Marca, e não coluna: na maioria das provas ninguém é devolvido,
                            e uma coluna inteira de zeros diria que algo aconteceu com
                            todos. Mesma razão pela qual a coluna de ocorrências só existe
                            onde o monitoramento esteve ligado. */}
                        {t.reaberturas > 0 && (
                          <p className="texto-suave sem-margem">
                            devolvida {t.reaberturas}× pelo professor
                          </p>
                        )}
                      </td>
                      <td>{t.pontuacaoObjetiva == null ? '—' : formatarPontos(t.pontuacaoObjetiva)}</td>
                      <td>
                        {t.totalDiscursivas === 0 ? (
                          <span className="texto-suave">não tem</span>
                        ) : (
                          <span className={t.correcaoConcluida ? 'situacao-ativa' : 'texto-erro'}>
                            {t.discursivasCorrigidas} de {t.totalDiscursivas}
                          </span>
                        )}
                      </td>
                      <td>{t.pontuacaoTotal == null ? '—' : <strong>{formatarPontos(t.pontuacaoTotal)}</strong>}</td>
                      {avaliacao.monitoramentoAtivo && (
                        // Zero em cinza, sem alarde: é o caso normal, e destacá-lo faria a
                        // tabela inteira parecer um painel de suspeitas.
                        <td className={t.ocorrencias > 0 ? '' : 'texto-suave'}>{t.ocorrencias}</td>
                      )}
                      <td>
                        {/* Os três botões em todas as linhas, a pedido do autor
                            (18/10/2026). Antes cada um só aparecia onde servia, e a
                            coluna ficava com os botões dançando de linha em linha —
                            custava mais para achar o certo do que o alinhamento
                            economizava em cliques mortos.
                            O que não se aplica fica DESABILITADO e diz por quê no
                            `title`: é isso que separa "não dá para clicar aqui" de
                            "cliquei e não aconteceu nada". */}
                        <div className="barra-acoes">
                          {/* Só onde o monitoramento esteve ligado — numa prova sem ele,
                              seria uma coluna de botões mortos para todo mundo. */}
                          {avaliacao.monitoramentoAtivo && (
                            <button
                              className="botao botao-secundario botao-pequeno"
                              type="button"
                              disabled={t.ocorrencias === 0}
                              title={t.ocorrencias === 0 ? 'Nenhuma ocorrência registrada nesta prova.' : undefined}
                              aria-expanded={aberta === t.id}
                              onClick={() => setAberta(aberta === t.id ? null : t.id)}
                            >
                              {aberta === t.id ? 'Ocultar eventos' : 'Ver eventos'}
                            </button>
                          )}
                          {/* `<a>` não aceita `disabled`: a desabilitação de um link é
                              classe, `aria-disabled` e o clique barrado — mesmo padrão do
                              "Fazer teste" no editor da avaliação. */}
                          <Link
                            className={`botao botao-secundario botao-pequeno${t.podeCorrigir ? '' : ' botao-inativo'}`}
                            to={`/professor/avaliacoes/${avaliacaoId}/correcao/${t.id}`}
                            aria-disabled={!t.podeCorrigir}
                            title={t.podeCorrigir ? undefined : 'A prova ainda não foi entregue.'}
                            onClick={(e) => {
                              if (!t.podeCorrigir) e.preventDefault();
                            }}
                          >
                            {t.correcaoConcluida ? 'Revisar' : 'Corrigir'}
                          </Link>
                          {/* Depois de liberar os resultados, devolver mudaria uma nota
                              que o estudante já viu — e aí o botão some de toda a tabela,
                              porque a razão vale para a avaliação inteira, não para uma
                              linha. */}
                          {/* Devolver só vale para prova FECHADA: a que está em andamento
                              já está com o estudante, e não há o que devolver. Depois de
                              devolvida, o botão desabilita sozinho — e volta a habilitar
                              quando ela for entregue, ou encerrada por tempo ou pelo
                              monitoramento, de novo. É o que mostra que a devolução
                              surtiu efeito. */}
                          {!avaliacao.resultadosLiberados && (
                            <button
                              className="botao botao-secundario botao-pequeno"
                              type="button"
                              disabled={devolvendo || t.emAndamento}
                              title={t.emAndamento ? 'A prova está em andamento: não há o que devolver.' : undefined}
                              onClick={() => setReabrindo(t.id)}
                            >
                              {devolvendo ? 'Devolvendo…' : 'Devolver prova'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {aberta && (
              <div className="espaco-acima">
                <h4 className="cartao-titulo">Linha do tempo</h4>
                <LinhaDoTempo avaliacaoId={avaliacaoId} tentativaId={aberta} />
              </div>
            )}

            {/* O caso da queda de energia na sala: devolver uma por uma seria inviável.
                Estender a data da avaliação não resolveria — cada prova guarda o próprio
                prazo, calculado quando o estudante começou. */}
            {!avaliacao.resultadosLiberados && (
              <div className="barra-acoes espaco-acima">
                <button
                  className="botao botao-secundario"
                  type="button"
                  disabled={devolvendo}
                  onClick={() => setReabrindo('turma')}
                >
                  {devolvendo ? 'Devolvendo…' : 'Devolver a prova à turma'}
                </button>
                <span className="texto-suave">
                  Para quando o problema atingiu todos — queda de energia, queda da internet.
                </span>
              </div>
            )}

            <Dialogo
              aberto={reabrindo !== null}
              titulo={reabrindo === 'turma' ? 'Devolver a prova à turma?' : 'Devolver a prova ao estudante?'}
              confirmar="Devolver com esse tempo"
              podeConfirmar={motivo.trim().length >= 3 && Number(minutos) > 0}
              cancelar="Cancelar"
              aoConfirmar={confirmarReabertura}
              aoCancelar={() => setReabrindo(null)}
            >
              <p>
                {reabrindo === 'turma'
                  ? 'Todas as provas voltam a ficar em andamento, com prazo novo contado a partir de agora — inclusive as de quem ainda está respondendo.'
                  : 'A prova volta a ficar em andamento, com prazo novo contado a partir de agora.'}{' '}
                As respostas já dadas são mantidas: o estudante continua de onde parou, e a nota é recalculada na
                nova entrega.
              </p>

              <div className="linha-campos">
                <Campo
                  id="minutosReabertura"
                  rotulo="Quantos minutos"
                  type="number"
                  min="1"
                  max="600"
                  inputMode="numeric"
                  value={minutos}
                  onChange={(e) => setMinutos(e.target.value)}
                />
              </div>

              <Campo
                id="motivoReabertura"
                rotulo="Motivo"
                value={motivo}
                dica="Fica registrado com o seu nome e a data. É o que explica a exceção depois."
                onChange={(e) => setMotivo(e.target.value)}
              />

              {/* O limite de ocorrências recomeça do zero: sem isso, quem foi bloqueado
                  voltaria a ser no primeiro evento e a devolução não valeria de nada. */}
              {avaliacao.monitoramentoAtivo && (
                <p className="texto-suave">
                  A contagem de ocorrências do monitoramento recomeça. Os eventos anteriores continuam na linha do
                  tempo, mas deixam de contar para o limite.
                </p>
              )}
            </Dialogo>
          </>
        )}
      </section>
    </>
  );
}
