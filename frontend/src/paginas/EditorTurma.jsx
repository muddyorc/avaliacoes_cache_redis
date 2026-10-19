// UC06 — criar e editar os dados de uma turma (RF06).
//
// /professor/turmas/nova        → formulário em branco; ao criar, a tela segue para a
//                                 turma, onde o professor encontra o código gerado.
// /professor/turmas/:id/editar  → mesmo formulário, mais inativar a turma.
//
// O que é **consulta e administração do dia a dia** (código de acesso, solicitações,
// estudantes, avaliações vinculadas) vive na tela da turma, em `TurmaProfessor.jsx`:
// cada coisa em um lugar só, sem duas versões da mesma lista.
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { Layout } from '../componentes/Layout.jsx';

export function EditorTurma() {
  const { id } = useParams();
  const nova = !id;
  const navegar = useNavigate();
  const local = useLocation();

  const [turma, setTurma] = useState(null);
  const [carregando, setCarregando] = useState(!nova);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [form, setForm] = useState({ nome: '', descricao: '', requerAprovacao: false });
  const [campos, setCampos] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  const aplicar = useCallback((t) => {
    setTurma(t);
    setForm({ nome: t.nome, descricao: t.descricao ?? '', requerAprovacao: t.requerAprovacao });
  }, []);

  // Mensagem vinda da navegação (ex.: "Turma criada"): lida uma vez e apagada do
  // histórico, para não reaparecer ao recarregar.
  useEffect(() => {
    if (!local.state?.mensagem) return;
    setMensagem(local.state.mensagem);
    navegar(local.pathname, { replace: true, state: null });
  }, [local.state, local.pathname, navegar]);

  useEffect(() => {
    if (nova) return undefined;
    let ativo = true;
    setCarregando(true);
    api(`/turmas/${id}`)
      .then((d) => ativo && aplicar(d.turma))
      .catch((f) => ativo && setErro(f.message))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [id, nova, aplicar]);

  async function salvar(evento) {
    evento.preventDefault();
    setErro('');
    setMensagem('');
    setCampos({});
    setSalvando(true);
    try {
      if (nova) {
        const { turma: criada } = await api('/turmas', { metodo: 'POST', corpo: form });
        navegar(`/professor/turmas/${criada.id}`, {
          replace: true,
          state: { mensagem: 'Turma criada. Compartilhe o código de acesso com os estudantes.' },
        });
        return;
      }
      aplicar((await api(`/turmas/${id}`, { metodo: 'PUT', corpo: form })).turma);
      setMensagem('Turma atualizada.');
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
    } finally {
      setSalvando(false);
    }
  }

  async function executar(chave, requisicao, textoSucesso, confirmar) {
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(chave);
    setErro('');
    setMensagem('');
    try {
      aplicar((await requisicao()).turma);
      setMensagem(textoSucesso);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(null);
    }
  }

  if (carregando) {
    return (
      <Layout titulo="Turma">
        <div className="conteudo-central">
          <Carregando />
        </div>
      </Layout>
    );
  }
  if (!nova && !turma) {
    return (
      <Layout titulo="Turma">
        <div className="conteudo-central">
          <Aviso tipo="erro">{erro || 'Turma não encontrada.'}</Aviso>
          <Link to="/professor/turmas">Voltar para as turmas</Link>
        </div>
      </Layout>
    );
  }

  const ativa = nova || turma.situacao === 'ATIVA';

  return (
    // Com menu, como o editor de AVALIAÇÃO já tinha: são telas do mesmo tipo, e uma ter
    // navegação e a outra não era incoerência, não decisão.
    <Layout titulo={nova ? 'Nova turma' : 'Editar turma'}>
      <div className="conteudo-central">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>{nova ? 'Nova turma' : turma.nome}</h1>
          {!nova && (
            <p>
              {turma.totalEstudantes} {turma.totalEstudantes === 1 ? 'estudante' : 'estudantes'} ·{' '}
              {turma.requerAprovacao ? 'entrada com aprovação' : 'entrada direta'}
              {!ativa && ' · inativa'}
            </p>
          )}
        </div>
        <div className="barra-acoes">
          {/* Sem "Desempenho" aqui: esta tela é de EDITAR a turma, e consultar números no
              meio de um formulário com alterações não salvas é convite a perdê-las. O
              caminho para o desempenho está na tela da turma e no menu lateral. */}
          <Link className="botao botao-secundario" to={nova ? '/professor/turmas' : `/professor/turmas/${id}`}>
            Voltar
          </Link>
        </div>
      </header>

      <Aviso tipo="erro">{erro}</Aviso>
      <Aviso tipo="sucesso">{mensagem}</Aviso>

      {!ativa && (
        <div className="aviso aviso-alerta">
          <p className="sem-margem">
            Turma inativa: ninguém entra pelo código e ela não recebe novas avaliações. Estudantes e histórico foram
            preservados.
          </p>
          <div className="barra-acoes espaco-acima-pequeno">
            <button
              className="botao botao-secundario botao-pequeno"
              type="button"
              disabled={ocupado === 'situacao'}
              onClick={() =>
                executar(
                  'situacao',
                  () => api(`/turmas/${id}/situacao`, { metodo: 'PATCH', corpo: { situacao: 'ATIVA' } }),
                  'Turma reativada.',
                )
              }
            >
              Reativar turma
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- dados */}
      <section className="painel">
        <h2>Dados da turma</h2>
        <form onSubmit={salvar} noValidate>
          <fieldset className="sem-borda" disabled={!ativa}>
            <Campo
              id="nome"
              rotulo="Nome"
              required
              autoFocus={nova}
              value={form.nome}
              erro={campos.nome}
              dica="Ex.: Banco de Dados — 3º período — Noturno"
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
            <Campo
              id="descricao"
              rotulo="Descrição (opcional)"
              multilinha
              rows={2}
              value={form.descricao}
              erro={campos.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
            <fieldset className="grupo-visibilidade">
              <legend>Como os estudantes entram</legend>
              <label className="opcao-descrita">
                <input
                  type="radio"
                  name="entrada"
                  checked={!form.requerAprovacao}
                  onChange={() => setForm((f) => ({ ...f, requerAprovacao: false }))}
                />
                <span>
                  <strong>Entrada direta</strong> — quem digitar o código entra na hora.
                </span>
              </label>
              <label className="opcao-descrita">
                <input
                  type="radio"
                  name="entrada"
                  checked={form.requerAprovacao}
                  onChange={() => setForm((f) => ({ ...f, requerAprovacao: true }))}
                />
                <span>
                  <strong>Com aprovação</strong> — o código gera uma solicitação, e você aprova ou recusa cada uma.
                </span>
              </label>
            </fieldset>
          </fieldset>
          {ativa && (
            <div className="barra-acoes">
              <button className="botao" type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : nova ? 'Criar turma' : 'Salvar alterações'}
              </button>
              {nova && (
                <Link className="botao botao-secundario" to="/professor/turmas">
                  Cancelar
                </Link>
              )}
            </div>
          )}
        </form>
      </section>

      {!nova && (
        <>
          {ativa && (
            <div className="barra-acoes espaco-acima">
              <button
                className="botao botao-secundario"
                type="button"
                disabled={ocupado === 'situacao'}
                onClick={() =>
                  executar(
                    'situacao',
                    () => api(`/turmas/${id}/situacao`, { metodo: 'PATCH', corpo: { situacao: 'INATIVA' } }),
                    'Turma inativada. Nada foi apagado.',
                    'Inativar esta turma? Os estudantes continuam registrados, mas ninguém mais entra pelo código e ela não recebe novas avaliações.',
                  )
                }
              >
                Inativar turma
              </button>
            </div>
          )}
        </>
      )}
      </div>
    </Layout>
  );
}
