// UC07 — a turma da avaliação, dentro do editor (RF07).
//
// UMA turma por avaliação, decisão do autor em 15/10/2026. Antes era N:N — a mesma prova
// podia ir para várias turmas —, e isso tornava a prova um objeto sem lugar: ela não
// pertencia a turma nenhuma, e por isso precisava de uma listagem própria para ser
// encontrada. Agora a prova mora na turma, e quem quiser aplicar a mesma avaliação em
// outra turma **duplica**.
//
// O reaproveitamento continua existindo, só que no nível certo: o banco de questões. As
// questões são compartilhadas entre quantas provas forem; a prova é de uma turma.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export function TurmasDaAvaliacao({ avaliacao, aoAtualizar, aoMensagem, aoErro }) {
  const [minhas, setMinhas] = useState(null);
  const [escolhida, setEscolhida] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const { acoes, turmas, iniciada } = avaliacao;
  const turma = turmas[0] ?? null;

  useEffect(() => {
    if (!acoes.podeVincularTurmas) return undefined;
    let ativo = true;
    api('/turmas?situacao=ATIVA')
      .then((d) => ativo && setMinhas(d.turmas))
      .catch(() => ativo && setMinhas([]));
    return () => {
      ativo = false;
    };
  }, [acoes.podeVincularTurmas]);

  async function vincular() {
    if (!escolhida) return;
    setOcupado(true);
    aoErro('');
    aoMensagem('');
    try {
      const r = await api(`/avaliacoes/${avaliacao.id}/turmas`, {
        metodo: 'POST',
        corpo: { turmaIds: [Number(escolhida)] },
      });
      aoAtualizar(r.avaliacao);
      aoMensagem(`Avaliação agora é da turma ${r.avaliacao.turmas[0]?.nome ?? ''}.`);
      setEscolhida('');
    } catch (falha) {
      aoErro(falha.message);
    } finally {
      setOcupado(false);
    }
  }


  return (
    <section className="painel espaco-acima">
      <h2>Turma</h2>

      {turma ? (
        <>
          <p className="texto-suave">
            Só os estudantes desta turma poderão fazer a avaliação. Para aplicá-la{' '}
            <strong>também</strong> a outra turma, duplique-a — as questões vêm do banco e são reusadas pela cópia.
          </p>
          <ul className="lista-pessoas">
            <li>
              <div>
                <Link to={`/professor/turmas/${turma.id}`}>{turma.nome}</Link>{' '}
                <span className="texto-suave">
                  · {turma.totalEstudantes} {turma.totalEstudantes === 1 ? 'estudante' : 'estudantes'}
                  {turma.situacao === 'INATIVA' && ' · turma inativa'}
                </span>
              </div>
              {/* Não há "Retirar": sem turma, a prova não aparece em lista nenhuma — a
                  tela da turma só mostra o que está vinculado, e a listagem de avaliações
                  deixou de existir. Retirar era, na prática, esconder a prova.
                  Para mudar de público existe trocar, abaixo; para apagar de verdade
                  existe "Excluir", em Publicação e gerenciamento. */}
            </li>
          </ul>
          {iniciada ? (
            <p className="texto-suave">
              Já iniciada por estudantes: a turma não pode mais ser trocada. Duplique a avaliação para aplicá-la em
              outra turma.
            </p>
          ) : (
            acoes.podeVincularTurmas &&
            minhas &&
            minhas.length > 1 && (
              // Trocar numa operação só. Retirar e vincular de novo deixava a prova sem
              // turma entre os dois passos — e publicada, inválida nesse intervalo.
              // 1 rem acima e 1 rem abaixo: o rótulo fica no meio do caminho entre a
              // linha da turma atual e o seletor. A folga de baixo também acomoda o anel
              // de foco, que o campo desenha por fora da borda ao ser usado.
              <div className="campo espaco-acima-pequeno">
                <label className="espaco-abaixo" htmlFor="trocarTurma">
                  Trocar para outra turma
                </label>
                <select
                  id="trocarTurma"
                  value={escolhida}
                  onChange={(e) => setEscolhida(e.target.value)}
                  disabled={ocupado}
                >
                  <option value="">Selecione…</option>
                  {minhas
                    .filter((t) => t.id !== turma.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome} — {t.totalEstudantes} {t.totalEstudantes === 1 ? 'estudante' : 'estudantes'}
                      </option>
                    ))}
                </select>
                <div className="barra-acoes espaco-acima-pequeno">
                  <button className="botao botao-secundario" type="button" disabled={!escolhida || ocupado} onClick={vincular}>
                    {ocupado ? 'Trocando…' : 'Trocar turma'}
                  </button>
                </div>
              </div>
            )
          )}
        </>
      ) : (
        <>
          <p className="texto-suave">
            A avaliação ainda não tem turma. É preciso uma para publicar — só os estudantes dela farão a prova.
          </p>

          {acoes.podeVincularTurmas &&
            minhas &&
            (minhas.length === 0 ? (
              <p className="texto-suave">
                Você ainda não tem turmas ativas. <Link to="/professor/turmas/nova">Crie uma turma</Link>.
              </p>
            ) : (
              // Um seletor, e não caixas de marcação: a forma do controle diz que a
              // escolha é única. Marcar várias e descobrir depois que só uma vale seria
              // a interface prometendo o que o sistema não faz.
              <div className="campo">
                <label htmlFor="turmaDaAvaliacao">Escolha a turma</label>
                <select
                  id="turmaDaAvaliacao"
                  value={escolhida}
                  onChange={(e) => setEscolhida(e.target.value)}
                  disabled={ocupado}
                >
                  <option value="">Selecione…</option>
                  {minhas.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome} — {t.totalEstudantes} {t.totalEstudantes === 1 ? 'estudante' : 'estudantes'}
                    </option>
                  ))}
                </select>
                <div className="barra-acoes espaco-acima-pequeno">
                  <button className="botao" type="button" disabled={!escolhida || ocupado} onClick={vincular}>
                    {ocupado ? 'Vinculando…' : 'Vincular à turma'}
                  </button>
                </div>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
