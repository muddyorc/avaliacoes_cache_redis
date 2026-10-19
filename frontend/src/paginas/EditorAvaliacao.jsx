// UC03 / UC04 — criar, editar, montar, publicar e gerenciar uma avaliação.
//
// /professor/avaliacoes/nova  → só as informações gerais; ao criar, segue para /:id.
//                               Com `?turma=`, a avaliação já nasce vinculada à turma.
// /professor/avaliacoes/:id   → questões, configurações e publicação, em abas.
//
// Referência visual: o editor do Google Forms — cartão de cabeçalho com faixa colorida,
// um cartão por questão e um trilho de ações ao lado da lista. O conteúdo é o nosso: as
// questões vêm do **banco de questões** (P-01), então o cartão mostra a questão e a
// pontuação dela nesta prova; editar o texto é no banco, porque a mesma questão pode
// estar em outras avaliações.
//
// Depois da primeira tentativa (P-15a) ou do arquivamento, tudo vira somente leitura e
// sobram consultar, arquivar e duplicar. A tela reflete o que o backend informa em
// `acoes`; o backend recusa de novo qualquer tentativa pela API.
import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { EstadoVazio } from '../componentes/EstadoVazio.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { SeloStatus } from '../componentes/SeloStatus.jsx';
import { FormularioQuestao } from '../componentes/FormularioQuestao.jsx';
import { TurmasDaAvaliacao } from '../componentes/TurmasDaAvaliacao.jsx';
import { PainelCorrecao } from '../componentes/PainelCorrecao.jsx';
import { MenuAcoes } from '../componentes/MenuAcoes.jsx';
import {
  IconeArquivar,
  IconeDuplicar,
  IconeExcluir,
  IconeMais,
  IconeProva,
  IconeSeta,
} from '../componentes/Icones.jsx';
import { deCampoLocal, formatarPontos, paraCampoLocal } from '../utils/datas.js';

const ROTULO_TIPO = { OBJETIVA: 'Objetiva', DISCURSIVA: 'Discursiva' };

// Nada além da nota: é o padrão das colunas no banco (005_divulgacao_resultados) e o
// estado inicial da avaliação que ainda não existe.
const PADRAO_DIVULGACAO = { gabarito: false, mediaTurma: false, distribuicao: false, questoesDestaque: false };
const LETRAS = 'ABCDEFGHIJ';

// Duas abas, e não três: a "Publicação" foi absorvida por "Configurações" a pedido do
// orientador (13/10/2026), que se perdeu navegando entre elas ao testar o sistema.
//
// A causa era concreta: a aba Publicação listava o que impedia publicar, mas NENHUMA das
// pendências se resolvia nela — questões ficavam numa aba, período e turmas em outra. A
// tela dizia o que faltava sem oferecer como fazer.
const ABAS = [
  { chave: 'questoes', rotulo: 'Questões' },
  { chave: 'configuracoes', rotulo: 'Configurações' },
  // A correção era tela separada, alcançada por botão. Virou aba (item 9 do feedback) e
  // absorveu o monitoramento, que era uma terceira tela com as MESMAS linhas e outras
  // colunas. Só aparece quando alguém fez a prova: antes disso não há o que corrigir.
  { chave: 'correcao', rotulo: 'Correção', somenteComProvas: true },
];

// Converte a avaliação da API para os valores dos campos do formulário.
function paraFormulario(a) {
  return {
    titulo: a?.titulo ?? '',
    descricao: a?.descricao ?? '',
    duracaoMinutos: a ? String(a.duracaoMinutos) : '60',
    dataInicio: paraCampoLocal(a?.dataInicio),
    dataFim: paraCampoLocal(a?.dataFim),
    monitoramentoAtivo: a?.monitoramentoAtivo ?? true,
    limiteOcorrencias: a?.limiteOcorrencias == null ? '' : String(a.limiteOcorrencias),
  };
}

function paraItens(a) {
  return (a?.questoes ?? []).map((q) => ({ ...q, pontuacao: String(q.pontuacao).replace('.', ',') }));
}

export function EditorAvaliacao() {
  const { id } = useParams();
  const nova = !id;
  const navegar = useNavigate();
  const local = useLocation();
  // Turma de origem, quando a criação veio de dentro de uma turma.
  const [parametros, definirParametros] = useSearchParams();
  const turmaDeOrigem = parametros.get('turma');
  // A aba vive na URL para que "abrir a correção" seja um endereço, e não um clique a
  // mais: é o que permite aos antigos /correcao e /monitoramento redirecionarem para cá.
  const abaDaUrl = parametros.get('aba');

  const [avaliacao, setAvaliacao] = useState(null);
  const [carregando, setCarregando] = useState(!nova);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState(local.state?.mensagem ?? '');
  const abaValida = ABAS.some((a) => a.chave === abaDaUrl) ? abaDaUrl : 'questoes';
  const [aba, definirAba] = useState(abaValida);

  // Trocar de aba troca a URL: recarregar a página ou compartilhar o link cai no mesmo
  // lugar. `replace` para que o botão Voltar do navegador saia do editor, e não percorra
  // cada aba visitada.
  const setAba = (chave) => {
    definirAba(chave);
    const novos = new URLSearchParams(parametros);
    if (chave === 'questoes') novos.delete('aba');
    else novos.set('aba', chave);
    definirParametros(novos, { replace: true });
  };

  const [form, setForm] = useState(paraFormulario(null));
  const [campos, setCampos] = useState({});
  const [salvando, setSalvando] = useState(false);

  const [itens, setItens] = useState([]);
  const [itensAlterados, setItensAlterados] = useState(false);
  const [camposQuestoes, setCamposQuestoes] = useState({});
  const [salvandoQuestoes, setSalvandoQuestoes] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [criandoQuestao, setCriandoQuestao] = useState(false);
  // Questão em edição pela tela da prova. Guarda o detalhe completo (com alternativas),
  // que a lista da avaliação não traz.
  const [editandoQuestao, setEditandoQuestao] = useState(null);
  const [temas, setTemas] = useState([]);
  const [abrindoBanco, setAbrindoBanco] = useState(false);
  // O que o estudante verá quando os resultados forem liberados (RF13 estendido).
  const [divulgacao, setDivulgacao] = useState(PADRAO_DIVULGACAO);
  const [salvandoDivulgacao, setSalvandoDivulgacao] = useState(false);
  // Alternativas carregadas sob demanda, por questão: o detalhe da avaliação não as traz.
  const [alternativas, setAlternativas] = useState({});

  const aplicar = useCallback((a) => {
    setAvaliacao(a);
    setForm(paraFormulario(a));
    setItens(paraItens(a));
    setItensAlterados(false);
    setDivulgacao(a?.divulgacao ?? PADRAO_DIVULGACAO);
  }, []);

  // Ao ir de /nova para /:id (ou de uma avaliação para a sua cópia) o React reaproveita
  // este componente: a mensagem enviada na navegação precisa ser lida de novo.
  // Depois de lida, a mensagem é apagada do histórico: senão o navegador a devolve a
  // cada recarga, e "Avaliação criada" reapareceria dias depois, fora de contexto.
  useEffect(() => {
    if (!local.state?.mensagem) return;
    setMensagem(local.state.mensagem);
    navegar(local.pathname, { replace: true, state: null });
  }, [local.state, local.pathname, navegar]);

  // A aba segue a URL. Isso cobre dois casos de uma vez: trocar de avaliação (duplicar,
  // por exemplo) reaproveita este componente e cai nas questões, que é por onde se começa
  // numa prova recém-aberta; e um link direto para a correção abre nela, sem clique a
  // mais — é o que permite aos endereços antigos redirecionarem para cá.
  useEffect(() => definirAba(abaValida), [id, abaValida]);

  useEffect(() => {
    if (nova) return undefined;
    let ativo = true;
    setCarregando(true);
    api(`/avaliacoes/${id}`)
      .then((d) => ativo && aplicar(d.avaliacao))
      .catch((f) => ativo && setErro(f.message))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [id, nova, aplicar]);

  const editavel = nova || Boolean(avaliacao?.acoes.podeEditar);
  const alterar = (campo) => (e) => {
    const valor = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({
      ...f,
      [campo]: valor,
      // Sem monitoramento não há limite (P-06): limpa o campo junto.
      ...(campo === 'monitoramentoAtivo' && !valor ? { limiteOcorrencias: '' } : {}),
    }));
  };

  // ------------------------------------------------------------ informações gerais
  async function salvarInformacoes(evento) {
    evento?.preventDefault();
    setErro('');
    setMensagem('');
    setCampos({});
    setSalvando(true);
    const corpo = {
      ...form,
      dataInicio: deCampoLocal(form.dataInicio),
      dataFim: deCampoLocal(form.dataFim),
      // Só na criação: depois que a avaliação existe, cada caixa se grava sozinha pela
      // rota própria — que continua valendo com a prova já aplicada, quando este PUT
      // não vale mais.
      ...(nova ? { divulgacao } : {}),
    };
    try {
      if (nova) {
        const { avaliacao: criada } = await api('/avaliacoes', { metodo: 'POST', corpo });
        // Criada a partir de uma turma (`?turma=`): já nasce vinculada a ela, que é o
        // que o professor quis ao clicar em "Criar prova" dentro da turma.
        let vinculada = false;
        if (turmaDeOrigem) {
          try {
            await api(`/avaliacoes/${criada.id}/turmas`, {
              metodo: 'POST',
              corpo: { turmaIds: [Number(turmaDeOrigem)] },
            });
            vinculada = true;
          } catch {
            // O vínculo falhou (turma inativa, por exemplo): a avaliação existe e o
            // professor vincula na própria tela, sem perder o que preencheu.
          }
        }
        navegar(`/professor/avaliacoes/${criada.id}`, {
          replace: true,
          state: {
            mensagem: vinculada
              ? 'Avaliação criada em rascunho e vinculada à turma. Agora adicione as questões.'
              : 'Avaliação criada em rascunho. Agora adicione as questões.',
          },
        });
        return;
      }
      aplicar((await api(`/avaliacoes/${id}`, { metodo: 'PUT', corpo })).avaliacao);
      setMensagem('Informações salvas.');
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
      // O erro pode estar em um campo de outra aba; leva o professor até ele.
      if (falha.campos && Object.keys(falha.campos).some((c) => c !== 'titulo' && c !== 'descricao')) {
        setAba('configuracoes');
      }
    } finally {
      setSalvando(false);
    }
  }

  // --------------------------------------------------------------------- questões
  function mudarItens(fn) {
    setItens(fn);
    setItensAlterados(true);
    setMensagem('');
  }

  function mover(indice, delta) {
    mudarItens((lista) => {
      const destino = indice + delta;
      if (destino < 0 || destino >= lista.length) return lista;
      const copia = [...lista];
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });
  }

  function adicionar(questao) {
    mudarItens((lista) => [
      ...lista,
      {
        questaoId: questao.id,
        enunciado: questao.enunciado,
        tipo: questao.tipo,
        tema: questao.tema,
        situacao: questao.situacao,
        pontuacao: String(questao.pontuacaoPadrao).replace('.', ','),
      },
    ]);
  }

  const corpoQuestoes = (lista) => ({
    questoes: lista.map((i) => ({ questaoId: i.questaoId, pontuacao: String(i.pontuacao).replace(',', '.') })),
  });

  async function abrirCriacaoDeQuestao() {
    setErro('');
    setMensagem('');
    try {
      setTemas((await api('/questoes/temas')).temas);
    } catch {
      setTemas([]); // sem sugestões de tema; o formulário funciona do mesmo jeito
    }
    setCriandoQuestao(true);
  }

  // A questão criada aqui nasce SÓ PARA ESTA PROVA (`noBanco: false`) e entra na
  // avaliação em seguida. Ela vai para o banco de questões apenas se o professor pedir,
  // pelo botão "Adicionar ao banco" — pedido do orientador em 15/10/2026, porque o banco
  // existe para reuso e enchia de questões escritas para uma prova só.
  //
  // Erros de validação da questão sobem para o formulário, que os mostra por campo.
  // Promover ao banco é só de ida: para tirar de lá existe inativar, que já protege o que
  // está em uso por outras provas.
  async function promoverQuestao(questaoId) {
    setErro('');
    setMensagem('');
    setOcupado(true);
    try {
      await api(`/questoes/${questaoId}/promover`, { metodo: 'POST' });
      // Recarrega a avaliação para o botão sumir da questão promovida.
      aplicar((await api(`/avaliacoes/${id}`)).avaliacao);
      setMensagem('Questão adicionada ao banco. Agora ela pode ser reusada em outras provas.');
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(false);
    }
  }

  // Abre o formulário com a questão inteira. A lista da avaliação traz só enunciado e
  // tipo; alternativas e critérios vêm do detalhe.
  async function abrirEdicaoDeQuestao(questaoId) {
    setErro('');
    setMensagem('');
    try {
      const [{ questao }, { temas: lista }] = await Promise.all([
        api(`/questoes/${questaoId}`),
        api('/questoes/temas'),
      ]);
      setTemas(lista);
      setEditandoQuestao(questao);
    } catch (falha) {
      setErro(falha.message);
    }
  }

  async function salvarEdicaoDaQuestao(valores) {
    const r = await api(`/avaliacoes/${id}/questoes/${editandoQuestao.id}`, { metodo: 'PUT', corpo: valores });
    aplicar(r.avaliacao);
    setEditandoQuestao(null);
    setMensagem(
      // A mensagem diz o que aconteceu de fato: vindo do banco, a prova ganhou uma
      // cópia, e o banco ficou como estava. Sem isso o professor acharia que mexeu no
      // banco — ou, pior, acharia que não mexeu quando mexeu.
      editandoQuestao.uso?.noBanco === false
        ? 'Questão atualizada.'
        : 'Esta prova passou a usar uma cópia sua da questão. A do banco de questões não mudou.',
    );
  }

  async function criarQuestaoNaProva(valores) {
    const { questao } = await api('/questoes', { metodo: 'POST', corpo: { ...valores, noBanco: false } });
    const novaLista = [
      ...itens,
      {
        questaoId: questao.id,
        enunciado: questao.enunciado,
        tipo: questao.tipo,
        tema: questao.tema,
        situacao: questao.situacao,
        pontuacao: String(questao.pontuacaoPadrao),
      },
    ];
    setCriandoQuestao(false);
    try {
      // Salva a lista inteira: se havia reordenações pendentes, elas vão junto.
      aplicar((await api(`/avaliacoes/${id}/questoes`, { metodo: 'PUT', corpo: corpoQuestoes(novaLista) })).avaliacao);
      setMensagem('Questão criada no banco de questões e adicionada a esta avaliação.');
    } catch (falha) {
      // A questão já existe no banco; só o vínculo falhou (ex.: prova iniciada agora).
      setErro(`A questão foi salva no banco de questões, mas não pôde ser adicionada: ${falha.message}`);
    }
  }

  async function salvarQuestoes() {
    setErro('');
    setMensagem('');
    setCamposQuestoes({});
    setSalvandoQuestoes(true);
    try {
      aplicar((await api(`/avaliacoes/${id}/questoes`, { metodo: 'PUT', corpo: corpoQuestoes(itens) })).avaliacao);
      setMensagem('Questões salvas.');
    } catch (falha) {
      setErro(falha.message);
      setCamposQuestoes(falha.campos || {});
    } finally {
      setSalvandoQuestoes(false);
    }
  }

  // Alternativas só do que o professor abrir: uma prova longa não precisa buscar tudo.
  //
  // Prova já aplicada mostra a **cópia** dela, que vem junto no detalhe (P-22); prova
  // ainda não aplicada busca no banco, que é de onde ela vai tirar as questões.
  async function alternarAlternativas(item) {
    const questaoId = item.questaoId;
    if (alternativas[questaoId]) {
      setAlternativas((a) => ({ ...a, [questaoId]: undefined }));
      return;
    }
    if (item.congelada) {
      setAlternativas((a) => ({ ...a, [questaoId]: { lista: item.alternativas ?? [] } }));
      return;
    }
    setAlternativas((a) => ({ ...a, [questaoId]: { carregando: true } }));
    try {
      const { questao } = await api(`/questoes/${questaoId}`);
      setAlternativas((a) => ({ ...a, [questaoId]: { lista: questao.alternativas ?? [] } }));
    } catch (falha) {
      setAlternativas((a) => ({ ...a, [questaoId]: { erro: falha.message } }));
    }
  }

  // ---------------------------------------------------- divulgação dos resultados

  // Marcar uma caixa salva na hora: é configuração de exibição, sem efeito no histórico,
  // e obrigar a clicar em "salvar" só criaria uma chance a mais de esquecer.
  //
  // Na criação não há o que salvar ainda: a avaliação não tem id, e as opções vão no
  // mesmo POST que a cria.
  async function alternarDivulgacao(chave) {
    const novasOpcoes = { ...divulgacao, [chave]: !divulgacao?.[chave] };
    setDivulgacao(novasOpcoes);
    if (nova) return;
    setSalvandoDivulgacao(true);
    setErro('');
    setMensagem('');
    try {
      const { avaliacao: atualizada } = await api(`/avaliacoes/${id}/divulgacao`, {
        metodo: 'PUT',
        corpo: novasOpcoes,
      });
      setAvaliacao(atualizada);
      setDivulgacao(atualizada.divulgacao);
    } catch (falha) {
      setDivulgacao(divulgacao); // desfaz a marcação que não foi gravada
      setErro(falha.message);
    } finally {
      setSalvandoDivulgacao(false);
    }
  }

  // ------------------------------------------------------ publicar, arquivar, etc.
  async function acao(caminho, textoSucesso, confirmar) {
    if (confirmar && !window.confirm(confirmar)) return;
    setErro('');
    setMensagem('');
    setOcupado(true);
    try {
      const resposta = await api(`/avaliacoes/${id}/${caminho}`, { metodo: 'POST' });
      if (caminho === 'excluir') {
        // A prova excluída não tem mais tela; o destino natural é a turma de onde ela veio.
        navegar(avaliacao?.turmas?.[0] ? `/professor/turmas/${avaliacao.turmas[0].id}` : '/professor/turmas', {
          replace: true,
        });
        return;
      }
      if (caminho === 'duplicar') {
        navegar(`/professor/avaliacoes/${resposta.avaliacao.id}`, { state: { mensagem: textoSucesso } });
        return;
      }
      aplicar(resposta.avaliacao);
      setMensagem(textoSucesso);
    } catch (falha) {
      setErro(falha.message);
    } finally {
      setOcupado(false);
    }
  }

  if (carregando) {
    return (
      <Layout titulo="Avaliação">
        <div className="conteudo-central">
          <Carregando mensagem="Abrindo a avaliação…" />
        </div>
      </Layout>
    );
  }

  if (editandoQuestao) {
    const doBanco = editandoQuestao.uso?.noBanco !== false;
    return (
      <Layout titulo="Editar questão">
        <FormularioQuestao
          dentroDaPagina
          questao={editandoQuestao}
          temas={temas}
          titulo="Editar a questão desta prova"
          subtitulo={
            doBanco
              ? 'Esta questão vem do seu banco. Salvar cria uma cópia só desta prova — a do banco continua como está, e outras provas que a usam não mudam.'
              : `Questão escrita para "${avaliacao.titulo}". As alterações valem só aqui.`
          }
          aoSalvar={salvarEdicaoDaQuestao}
          aoCancelar={() => setEditandoQuestao(null)}
        />
      </Layout>
    );
  }

  if (criandoQuestao) {
    return (
      <Layout titulo="Nova questão">
        <FormularioQuestao
          dentroDaPagina
          questao={null}
          temas={temas}
          titulo="Nova questão para esta avaliação"
          subtitulo={`Ela será salva no seu banco de questões e adicionada a "${avaliacao.titulo}".`}
          aoSalvar={criarQuestaoNaProva}
          aoCancelar={() => setCriandoQuestao(false)}
        />
      </Layout>
    );
  }

  if (!nova && !avaliacao) {
    return (
      <Layout titulo="Avaliação">
        <div className="conteudo-central">
          <Aviso tipo="erro">{erro || 'Avaliação não encontrada.'}</Aviso>
          <Link className="link-voltar" to="/professor/turmas">
            <IconeSeta />
            Voltar para as turmas
          </Link>
        </div>
      </Layout>
    );
  }

  // A turma para onde "voltar" leva: a da prova, ou a de origem quando ela ainda está
  // sendo criada.
  const turmaDaProva = avaliacao?.turmas?.[0]?.id ?? turmaDeOrigem ?? null;

  const idsNaAvaliacao = new Set(itens.map((i) => i.questaoId));
  const totalPontos = itens.reduce((soma, i) => soma + (Number(String(i.pontuacao).replace(',', '.')) || 0), 0);
  const infoAlterada = !nova && avaliacao && JSON.stringify(form) !== JSON.stringify(paraFormulario(avaliacao));

  return (
    <Layout titulo={nova ? 'Nova avaliação' : `Avaliação ${avaliacao.titulo}`}>
      <div className="conteudo-central">
        {/* Volta para a turma da prova, e não para uma listagem de avaliações — que
            deixou de existir quando a prova passou a pertencer a uma turma.
            `turmaDeOrigem` cobre a criação, em que a avaliação ainda não foi salva e
            portanto ainda não tem turma vinculada; o parâmetro veio na URL. */}
        <Link className="link-voltar" to={turmaDaProva ? `/professor/turmas/${turmaDaProva}` : '/professor/turmas'}>
          <IconeSeta />
          {turmaDaProva ? 'Turma' : 'Turmas'}
        </Link>

        {/* ------------------------------------------- cabeçalho da prova (Forms) */}
        <section className="cartao cartao-formulario">
          <input
            id="titulo"
            className="campo-livre campo-livre-titulo"
            aria-label="Título da avaliação"
            placeholder="Avaliação sem título"
            disabled={!editavel}
            autoFocus={nova}
            value={form.titulo}
            aria-invalid={campos.titulo ? 'true' : undefined}
            onChange={alterar('titulo')}
          />
          {campos.titulo && <p className="campo-erro">{campos.titulo}</p>}

          <textarea
            id="descricao"
            className="campo-livre campo-livre-apoio"
            aria-label="Instruções para o estudante"
            placeholder="Instruções para o estudante (opcional)"
            rows={2}
            disabled={!editavel}
            value={form.descricao}
            onChange={alterar('descricao')}
          />
          {campos.descricao && <p className="campo-erro">{campos.descricao}</p>}

          {!nova && (
            <div className="cartao-formulario-rodape">
              <p className="texto-suave sem-margem">
                <SeloStatus status={avaliacao.status} /> {itens.length}{' '}
                {itens.length === 1 ? 'questão' : 'questões'} · {formatarPontos(totalPontos)}
              </p>
              {/* Testar é coisa de quem está montando a prova, então a ação fica junto
                  do título, visível em qualquer aba (P-20). */}
              <Link
                className={`botao botao-secundario${
                  avaliacao.totalQuestoes === 0 || itensAlterados ? ' botao-inativo' : ''
                }`}
                to={`/professor/avaliacoes/${id}/teste`}
                aria-disabled={avaliacao.totalQuestoes === 0 || itensAlterados}
                onClick={(e) => {
                  if (avaliacao.totalQuestoes === 0 || itensAlterados) e.preventDefault();
                }}
                title={
                  avaliacao.totalQuestoes === 0
                    ? 'Adicione questões para testar.'
                    : itensAlterados
                      ? 'Salve as questões antes de testar.'
                      : 'Responda como o estudante veria. Nada é salvo.'
                }
              >
                Fazer teste
              </Link>
            </div>
          )}
        </section>

        <Aviso tipo="erro">{erro}</Aviso>
        <Aviso tipo="sucesso">{mensagem}</Aviso>

        {!nova && avaliacao.iniciada && (
          <div className="aviso aviso-alerta" role="status">
            Esta avaliação já foi iniciada por {avaliacao.totalTentativas}{' '}
            {avaliacao.totalTentativas === 1 ? 'estudante' : 'estudantes'} e não pode mais ser alterada. As questões
            abaixo estão congeladas como os estudantes as viram — editá-las no banco de questões não muda esta prova.
            Você pode consultá-la, arquivá-la ou duplicá-la para criar uma nova avaliação.
          </div>
        )}
        {!nova && !avaliacao.iniciada && avaliacao.status === 'ARQUIVADA' && (
          <div className="aviso aviso-alerta" role="status">
            Avaliação arquivada: somente consulta. Duplique-a para reutilizar.
          </div>
        )}

        {/* Na criação não há abas: só o que é preciso para a avaliação existir. */}
        {nova ? (
          <section className="cartao">
            <h2>Configurações</h2>
            <form onSubmit={salvarInformacoes} noValidate>
              <ConfiguracoesDaProva form={form} campos={campos} alterar={alterar} editavel={editavel} />
              <VisibilidadeDosResultados
                valores={divulgacao}
                aoAlternar={alternarDivulgacao}
                salvando={false}
                naCriacao
              />
              <div className="barra-acoes">
                <button className="botao" type="submit" disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Criar avaliação'}
                </button>
                <Link className="botao botao-secundario" to="/professor/avaliacoes">
                  Cancelar
                </Link>
              </div>
            </form>
          </section>
        ) : (
          <>
            <div className="abas" role="tablist" aria-label="Partes da avaliação">
              {ABAS.filter((a) => !a.somenteComProvas || avaliacao.totalTentativas > 0).map(({ chave, rotulo }) => (
                <button
                  key={chave}
                  type="button"
                  role="tab"
                  aria-selected={aba === chave}
                  className={`aba ${aba === chave ? 'aba-ativa' : ''}`}
                  onClick={() => setAba(chave)}
                >
                  {rotulo}
                </button>
              ))}

              {/* Publicar fica na barra, ao lado das abas, a pedido do autor. Não é aba:
                  aba troca a vista e nada acontece, e publicar muda o estado da avaliação.
                  Por isso a confirmação — ela é o que torna esta posição segura, já que o
                  botão fica ao alcance de quem só queria trocar de aba. */}
              {avaliacao.status === 'RASCUNHO' && (
                <button
                  className="botao botao-publicar-barra"
                  type="button"
                  disabled={!avaliacao.acoes.podePublicar || itensAlterados || infoAlterada || ocupado}
                  title={
                    itensAlterados || infoAlterada
                      ? 'Salve as alterações antes de publicar.'
                      : !avaliacao.acoes.podePublicar
                        ? 'Ainda há pendências. Veja em Configurações.'
                        : undefined
                  }
                  onClick={() =>
                    acao(
                      'publicar',
                      'Avaliação publicada.',
                      'Publicar esta avaliação? Ela passa a ficar disponível para os estudantes das turmas vinculadas, no período definido.',
                    )
                  }
                >
                  Publicar
                </button>
              )}

              {/* Duplicar, arquivar e excluir vivem aqui, no fim da barra (16/10/2026).
                  Estavam num cartão "Publicação e gerenciamento" no pé da página que,
                  depois que Publicar subiu para a barra e a visibilidade virou cartão
                  próprio, tinha um título prometendo mais do que entregava: três botões
                  soltos. São ações da avaliação inteira, então pertencem ao cabeçalho
                  dela — e no menu de três pontos não disputam atenção com o conteúdo. */}
              <MenuAcoes rotulo="Mais ações da avaliação">
                <button
                  className="menu-item"
                  role="menuitem"
                  type="button"
                  disabled={ocupado}
                  onClick={() =>
                    acao('duplicar', 'Cópia criada na mesma turma, em rascunho. Para aplicá-la a outra, troque a turma em Configurações.')
                  }
                >
                  <IconeDuplicar className="icone" />
                  Duplicar
                </button>
                {avaliacao.acoes.podeArquivar && (
                  <button
                    className="menu-item"
                    role="menuitem"
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      acao(
                        'arquivar',
                        'Avaliação arquivada.',
                        'Arquivar esta avaliação? Ela sai da lista em andamento e não poderá mais ser editada.',
                      )
                    }
                  >
                    <IconeArquivar className="icone" />
                    Arquivar
                  </button>
                )}
                <button
                  className="menu-item"
                  role="menuitem"
                  type="button"
                  disabled={!avaliacao.acoes.podeExcluir || ocupado}
                  title={
                    !avaliacao.acoes.podeExcluir ? 'Já iniciada por estudantes: arquive em vez de excluir.' : undefined
                  }
                  onClick={() => acao('excluir', '', 'Excluir esta avaliação? Ela deixa de aparecer nas suas listas.')}
                >
                  <IconeExcluir className="icone" />
                  Excluir
                </button>
              </MenuAcoes>
            </div>

            {/* ------------------------------------------------------- questões */}
            {aba === 'questoes' && (
              <>
                <div className="com-trilho">
                  <div>
                    {itens.length === 0 ? (
                      <div className="cartao">
                        {/* Com a lista vazia, as ações do trilho aparecem por extenso:
                            um ícone sozinho não ensina por onde começar. */}
                        <EstadoVazio
                          Icone={IconeProva}
                          titulo="Nenhuma questão ainda"
                          acao={
                            editavel && (
                              <div className="barra-acoes">
                                <button className="botao" type="button" onClick={() => setAbrindoBanco(true)}>
                                  Adicionar do banco
                                </button>
                                <button className="botao botao-secundario" type="button" onClick={abrirCriacaoDeQuestao}>
                                  Criar nova questão
                                </button>
                              </div>
                            )
                          }
                        >
                          Monte a prova com questões do seu banco ou crie uma questão nova, que também vai para o
                          banco.
                        </EstadoVazio>
                      </div>
                    ) : (
                      <>
                        {/* A barra de salvar fica no TOPO da lista, e não no rodapé:
                            numa prova longa ela desaparecia da tela justamente enquanto o
                            professor lia as questões do meio — que é onde ele encontra
                            "Editar" desligado e precisa saber por quê. */}
                        {editavel && itensAlterados && (
                          <div className="barra-fixa" role="status">
                            <span>
                              Alterações não salvas · {itens.length} {itens.length === 1 ? 'questão' : 'questões'} ·{' '}
                              {formatarPontos(totalPontos)}
                              <br />
                              <span className="texto-suave">
                                Salve para poder editar as questões ou adicioná-las ao banco.
                              </span>
                            </span>
                            <div className="barra-acoes">
                              <button className="botao" type="button" disabled={salvandoQuestoes} onClick={salvarQuestoes}>
                                {salvandoQuestoes ? 'Salvando…' : 'Salvar questões'}
                              </button>
                            </div>
                          </div>
                        )}
                      <ol className="lista-questoes-editor">
                        {itens.map((item, i) => (
                          <li key={item.questaoId}>
                            <article className="questao-cartao">
                              <div className="questao-cartao-topo">
                                <span className="questao-cartao-numero">{i + 1}</span>
                                <span className="etiqueta">{ROTULO_TIPO[item.tipo]}</span>
                                {item.tema && <span className="etiqueta etiqueta-neutra">{item.tema}</span>}
                                {item.situacao === 'INATIVA' && (
                                  <span className="etiqueta etiqueta-alerta">
                                    Inativa no banco — remova para publicar
                                  </span>
                                )}
                              </div>

                              <p className="questao-cartao-enunciado">{item.enunciado}</p>

                              {item.tipo === 'OBJETIVA' && (
                                <div>
                                  <button
                                    className="botao botao-secundario botao-pequeno"
                                    type="button"
                                    aria-expanded={Boolean(alternativas[item.questaoId])}
                                    onClick={() => alternarAlternativas(item)}
                                  >
                                    {alternativas[item.questaoId] ? 'Ocultar alternativas' : 'Ver alternativas'}
                                  </button>
                                  {alternativas[item.questaoId]?.carregando && (
                                    <p className="texto-suave">Carregando…</p>
                                  )}
                                  {alternativas[item.questaoId]?.erro && (
                                    <p className="campo-erro">{alternativas[item.questaoId].erro}</p>
                                  )}
                                  {alternativas[item.questaoId]?.lista && (
                                    <ul className="alternativas-editor espaco-acima-pequeno">
                                      {alternativas[item.questaoId].lista.map((alt, indice) => (
                                        <li key={alt.id} className={alt.correta ? 'correta' : ''}>
                                          <span className="alternativa-letra" aria-hidden="true">
                                            {LETRAS[indice] ?? indice + 1}
                                          </span>
                                          <span className="quebra">
                                            {alt.texto}
                                            {alt.correta && <strong> · correta</strong>}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}

                              <div className="questao-cartao-rodape">
                                <label className="campo-pontos">
                                  <span>Pontos</span>
                                  <input
                                    inputMode="decimal"
                                    disabled={!editavel}
                                    aria-label={`Pontuação da questão ${i + 1}`}
                                    aria-invalid={camposQuestoes[`questoes.${i}.pontuacao`] ? 'true' : undefined}
                                    value={item.pontuacao}
                                    onChange={(e) =>
                                      mudarItens((lista) =>
                                        lista.map((x, j) => (j === i ? { ...x, pontuacao: e.target.value } : x)),
                                      )
                                    }
                                  />
                                </label>

                                {editavel && (
                                  <div className="acoes">
                                    <button
                                      className="botao botao-secundario botao-pequeno"
                                      type="button"
                                      disabled={i === 0}
                                      aria-label={`Subir a questão ${i + 1}`}
                                      onClick={() => mover(i, -1)}
                                    >
                                      ↑
                                    </button>
                                    <button
                                      className="botao botao-secundario botao-pequeno"
                                      type="button"
                                      disabled={i === itens.length - 1}
                                      aria-label={`Descer a questão ${i + 1}`}
                                      onClick={() => mover(i, 1)}
                                    >
                                      ↓
                                    </button>
                                    {/* Travados enquanto há questão por salvar, pelo mesmo
                                        motivo que "Publicar" e "Fazer teste" já são:
                                        a lista vive em estado local até "Salvar questões".
                                        Uma questão recém-puxada do banco ainda não existe
                                        na prova (o servidor responderia "não faz parte
                                        desta avaliação"), e recarregar a avaliação depois
                                        da ação descartaria o que estava montado. */}
                                    <button
                                      className="botao botao-secundario botao-pequeno"
                                      type="button"
                                      disabled={itensAlterados || ocupado}
                                      title={itensAlterados ? 'Salve as questões antes de editar.' : undefined}
                                      aria-label={`Editar a questão ${i + 1}`}
                                      onClick={() => abrirEdicaoDeQuestao(item.questaoId)}
                                    >
                                      Editar
                                    </button>
                                    {/* Só para quem ainda não está no banco: a questão foi
                                        escrita para esta prova, e o professor decide se
                                        vale guardar para reusar. */}
                                    {item.noBanco === false && (
                                      <button
                                        className="botao botao-secundario botao-pequeno"
                                        type="button"
                                        disabled={itensAlterados || ocupado}
                                        title={
                                          itensAlterados ? 'Salve as questões antes de adicionar ao banco.' : undefined
                                        }
                                        aria-label={`Adicionar a questão ${i + 1} ao banco de questões`}
                                        onClick={() => promoverQuestao(item.questaoId)}
                                      >
                                        Adicionar ao banco
                                      </button>
                                    )}
                                    <button
                                      className="botao botao-secundario botao-pequeno"
                                      type="button"
                                      aria-label={`Remover a questão ${i + 1}`}
                                      onClick={() => mudarItens((lista) => lista.filter((_, j) => j !== i))}
                                    >
                                      Remover
                                    </button>
                                  </div>
                                )}
                              </div>

                              {camposQuestoes[`questoes.${i}.pontuacao`] && (
                                <p className="campo-erro">{camposQuestoes[`questoes.${i}.pontuacao`]}</p>
                              )}
                            </article>
                          </li>
                        ))}
                      </ol>
                      </>
                    )}

                    {camposQuestoes.questoes && <p className="campo-erro">{camposQuestoes.questoes}</p>}
                  </div>

                  {/* Trilho de ações, como no Forms: adicionar fica ao lado da lista. */}
                  {editavel && (
                    <div className="trilho-acoes">
                      {/* O "+" cria; o ícone de folha busca no banco. Era o contrário, e
                          o sinal estava trocado: "+" é universalmente "criar algo novo",
                          e um documento sugere "pegar algo que existe". */}
                      {/* Com rótulo escrito ao lado do ícone: só o desenho obrigava a
                          passar o mouse e esperar a dica para descobrir o que cada um
                          faz — e no toque não há esse "passar o mouse". */}
                      <button className="botao-trilho" type="button" onClick={abrirCriacaoDeQuestao}>
                        <IconeMais />
                        <span>Criar questão</span>
                      </button>
                      <button
                        className="botao-trilho"
                        type="button"
                        aria-expanded={abrindoBanco}
                        onClick={() => setAbrindoBanco((v) => !v)}
                      >
                        <IconeProva />
                        <span>Buscar do banco</span>
                      </button>
                    </div>
                  )}
                </div>

                {editavel && abrindoBanco && <SeletorDoBanco idsNaAvaliacao={idsNaAvaliacao} aoAdicionar={adicionar} />}


              </>
            )}

            {/* -------------------------------------------------- configurações */}
            {aba === 'configuracoes' && (
              <>
                <section className="cartao">
                  <h2>Configurações</h2>

                  {/* As pendências de publicação ficam aqui, e não num cartão no fim da
                      página: quase todas se resolvem nesta tela — período, duração,
                      turma — e o botão Publicar está logo acima, na barra de abas. */}
                  {avaliacao.status === 'PUBLICADA' && avaliacao.pendenciasPublicacao.length > 0 && (
                    <div className="aviso aviso-alerta" role="status">
                      <p className="sem-margem">
                        <strong>Esta avaliação está publicada, mas tem pendências:</strong>
                      </p>
                      <ul className="lista-simples">
                        {avaliacao.pendenciasPublicacao.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {avaliacao.status === 'RASCUNHO' && (
                    <>
                      {avaliacao.pendenciasPublicacao.length > 0 ? (
                        <div className="aviso aviso-alerta">
                          <p className="sem-margem">Antes de publicar:</p>
                          <ul className="lista-simples">
                            {avaliacao.pendenciasPublicacao.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="texto-suave">
                          Tudo pronto para publicar. Depois de publicada, a avaliação ainda pode ser editada até o
                          primeiro estudante iniciá-la.
                        </p>
                      )}
                      {itensAlterados && <p className="cartao-aviso">Salve as questões antes de publicar.</p>}
                      {/* Com as abas separadas, publicar com o formulário por salvar era
                          impossível por acidente de navegação. Na tela única, passa a ser
                          possível — então a trava vira explícita. */}
                      {infoAlterada && <p className="cartao-aviso">Salve as informações antes de publicar.</p>}
                    </>
                  )}

                  <form onSubmit={salvarInformacoes} noValidate>
                    <ConfiguracoesDaProva form={form} campos={campos} alterar={alterar} editavel={editavel} />
                    {editavel && (
                      <div className="barra-acoes">
                        <button className="botao" type="submit" disabled={salvando || !infoAlterada}>
                          {salvando ? 'Salvando…' : 'Salvar informações'}
                        </button>
                        {infoAlterada && <span className="texto-suave">Há alterações não salvas.</span>}
                      </div>
                    )}
                  </form>
                </section>

                {/* Visibilidade logo abaixo das configurações, e não dentro de
                    "Publicação e gerenciamento" como antes (16/10/2026). Lá ela só
                    aparecia depois da primeira prova feita, e a essa altura o professor
                    está na aba Correção, onde fica o botão de liberar — ele nunca
                    voltaria aqui para escolher o que o estudante veria. */}
                <section className="cartao espaco-acima">
                  <h2>Visibilidade dos resultados</h2>
                  <VisibilidadeDosResultados
                    valores={divulgacao}
                    aoAlternar={alternarDivulgacao}
                    salvando={salvandoDivulgacao}
                    liberados={avaliacao.resultadosLiberados}
                  />
                </section>

                {/* setAvaliacao, e não aplicar: vincular turma não pode descartar
                    edições ainda não salvas no formulário ou nas questões. */}
                <TurmasDaAvaliacao
                  avaliacao={avaliacao}
                  aoAtualizar={setAvaliacao}
                  aoMensagem={setMensagem}
                  aoErro={setErro}
                />

              </>
            )}

            {/* ------------------------------------------- correção e monitoramento */}
            {aba === 'correcao' && <PainelCorrecao avaliacaoId={id} />}
          </>
        )}
      </div>
    </Layout>
  );
}

// O que o estudante vê quando os resultados forem liberados (RF13 estendido).
//
// Mesmo componente nos dois lugares, com um detalhe de comportamento diferente: na
// criação as marcações viajam no POST que cria a avaliação; depois disso cada caixa se
// grava sozinha, porque a rota própria continua valendo com a prova já aplicada — e é
// aí, com a prova feita, que o professor costuma mudar de ideia.
//
// Liberar a nota NÃO está aqui: é ação, mora na aba Correção, junto do que o professor
// acabou de corrigir (P-07). Aqui só se escolhe o que será mostrado quando isso ocorrer.
function VisibilidadeDosResultados({ valores, aoAlternar, salvando, naCriacao = false, liberados = false }) {
  const caixa = (chave, rotulo, dica) => (
    <div className="campo campo-marcador">
      <label>
        <input type="checkbox" checked={valores[chave]} disabled={salvando} onChange={() => aoAlternar(chave)} />{' '}
        {rotulo}
      </label>
      {dica && <p className="campo-dica">{dica}</p>}
    </div>
  );

  return (
    <>
      <p className="texto-suave">
        Quando os resultados forem liberados, cada estudante vê <strong>a própria nota</strong>. Marque o que mais
        deve aparecer para ele.
      </p>

      {caixa(
        'gabarito',
        'Correção questão a questão, com o gabarito',
        'Mostra as questões na ordem em que ele respondeu, o que ele marcou e o que era esperado.',
      )}
      {caixa('mediaTurma', 'Média da turma')}
      {caixa('distribuicao', 'Distribuição das notas por faixa')}
      {caixa('questoesDestaque', 'Questões que a turma mais acertou e mais errou')}

      <p className="texto-suave">
        Cada estudante compara com a <strong>própria turma</strong>. Os números são sempre anônimos — sem nome e
        sem a nota de ninguém — e só aparecem quando a turma tiver provas corrigidas suficientes para ninguém ser
        identificado por dedução.
      </p>

      <p className="texto-suave">
        {naCriacao
          ? 'Isto pode ser mudado depois, a qualquer momento — inclusive com a prova já aplicada.'
          : liberados
            ? 'Resultados já liberados: mudar uma marcação muda na hora o que o estudante vê.'
            : 'Cada marcação é salva na hora. A nota em si só chega ao estudante quando você liberar os resultados, na aba Correção.'}
      </p>
    </>
  );
}

// Campos que valem para a prova inteira. Ficam em um componente próprio porque a criação
// e a aba de configurações usam exatamente os mesmos.
function ConfiguracoesDaProva({ form, campos, alterar, editavel }) {
  return (
    /* fieldset desabilitado bloqueia todos os campos de uma vez no modo leitura */
    <fieldset disabled={!editavel} className="sem-borda">
      <div className="linha-campos">
        <Campo
          id="dataInicio"
          rotulo="Disponível a partir de"
          type="datetime-local"
          required
          value={form.dataInicio}
          erro={campos.dataInicio}
          onChange={alterar('dataInicio')}
        />
        <Campo
          id="dataFim"
          rotulo="Disponível até"
          type="datetime-local"
          required
          value={form.dataFim}
          erro={campos.dataFim}
          onChange={alterar('dataFim')}
        />
        <Campo
          id="duracaoMinutos"
          rotulo="Duração (minutos)"
          type="number"
          min="1"
          inputMode="numeric"
          required
          value={form.duracaoMinutos}
          erro={campos.duracaoMinutos}
          dica="Tempo de cada estudante, contado a partir do início da prova."
          onChange={alterar('duracaoMinutos')}
        />
      </div>

      <div className="campo campo-marcador">
        <label>
          <input type="checkbox" checked={form.monitoramentoAtivo} onChange={alterar('monitoramentoAtivo')} />{' '}
          Monitorar a integridade da avaliação
        </label>
        <p className="campo-dica">Registra troca de aba, perda de foco e atalhos de teclado durante a prova.</p>
      </div>
      {form.monitoramentoAtivo && (
        <Campo
          id="limiteOcorrencias"
          rotulo="Encerrar a prova após quantas ocorrências? (opcional)"
          type="number"
          min="1"
          inputMode="numeric"
          value={form.limiteOcorrencias}
          erro={campos.limiteOcorrencias}
          dica="Deixe em branco para apenas registrar as ocorrências, sem encerrar a prova."
          onChange={alterar('limiteOcorrencias')}
        />
      )}
    </fieldset>
  );
}

// Busca questões ATIVAS do banco do professor que ainda não estão na avaliação.
function SeletorDoBanco({ idsNaAvaliacao, aoAdicionar }) {
  // Alternativas carregadas sob demanda, como na lista da prova: a busca devolve oito
  // questões por vez, e trazer o gabarito de todas só para talvez abrir uma seria pedir
  // ao servidor o que quase sempre não é usado.
  const [alternativas, setAlternativas] = useState({});
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [tipo, setTipo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    const parametros = new URLSearchParams({ situacao: 'ATIVA', pagina: String(pagina), tamanho: '8' });
    if (buscaAplicada) parametros.set('busca', buscaAplicada);
    if (tipo) parametros.set('tipo', tipo);
    api(`/questoes?${parametros}`)
      .then((d) => ativo && setDados(d))
      .catch((f) => ativo && setErro(f.message));
    return () => {
      ativo = false;
    };
  }, [buscaAplicada, tipo, pagina]);

  async function alternarAlternativas(questaoId) {
    if (alternativas[questaoId]) {
      setAlternativas((atual) => {
        const copia = { ...atual };
        delete copia[questaoId];
        return copia;
      });
      return;
    }
    setAlternativas((atual) => ({ ...atual, [questaoId]: { carregando: true } }));
    try {
      const { questao } = await api(`/questoes/${questaoId}`);
      setAlternativas((atual) => ({ ...atual, [questaoId]: { lista: questao.alternativas ?? [] } }));
    } catch (falha) {
      setAlternativas((atual) => ({ ...atual, [questaoId]: { erro: falha.message } }));
    }
  }

  return (
    <div className="cartao seletor-banco">
      <h2>Adicionar do banco de questões</h2>
      <form
        className="filtros"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(1);
          setBuscaAplicada(busca.trim());
        }}
      >
        <Campo id="buscaBanco" rotulo="Buscar no enunciado" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="campo">
          <label htmlFor="tipoBanco">Tipo</label>
          <select
            id="tipoBanco"
            value={tipo}
            onChange={(e) => {
              setPagina(1);
              setTipo(e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="OBJETIVA">Objetivas</option>
            <option value="DISCURSIVA">Discursivas</option>
          </select>
        </div>
        <button className="botao botao-secundario" type="submit">
          Buscar
        </button>
      </form>

      <Aviso tipo="erro">{erro}</Aviso>

      {dados && dados.total === 0 && (
        <p className="texto-suave">
          Nenhuma questão ativa encontrada. <Link to="/professor/questoes">Cadastre questões no banco</Link>.
        </p>
      )}

      {dados && dados.questoes.length > 0 && (
        <ul className="lista-banco">
          {dados.questoes.map((q) => {
            const jaIncluida = idsNaAvaliacao.has(q.id);
            return (
              <li key={q.id}>
                <div>
                  <span className="selo">{ROTULO_TIPO[q.tipo]}</span>{' '}
                  <span className="texto-suave">{formatarPontos(q.pontuacaoPadrao)}</span>
                  <p className="cartao-enunciado">{q.enunciado}</p>
                  {/* Escolher uma questão pelo enunciado é escolher no escuro: duas
                      podem perguntar a mesma coisa e diferir nas alternativas, e é o
                      gabarito que decide qual serve à prova. */}
                  {q.tipo === 'OBJETIVA' && (
                    <>
                      <button
                        className="botao botao-secundario botao-pequeno espaco-acima-pequeno"
                        type="button"
                        aria-expanded={Boolean(alternativas[q.id])}
                        onClick={() => alternarAlternativas(q.id)}
                      >
                        {alternativas[q.id] ? 'Ocultar alternativas' : 'Ver alternativas'}
                      </button>
                      {alternativas[q.id]?.carregando && <p className="texto-suave">Carregando…</p>}
                      {alternativas[q.id]?.erro && <p className="campo-erro">{alternativas[q.id].erro}</p>}
                      {alternativas[q.id]?.lista && (
                        <ul className="alternativas-editor espaco-acima-pequeno">
                          {alternativas[q.id].lista.map((alt, indice) => (
                            <li key={alt.id} className={alt.correta ? 'correta' : ''}>
                              <span className="alternativa-letra" aria-hidden="true">
                                {LETRAS[indice] ?? indice + 1}
                              </span>
                              <span className="quebra">
                                {alt.texto}
                                {alt.correta && <strong> · correta</strong>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
                <button
                  className="botao botao-secundario botao-pequeno"
                  type="button"
                  disabled={jaIncluida}
                  onClick={() => aoAdicionar(q)}
                >
                  {jaIncluida ? 'Incluída' : 'Adicionar'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {dados && dados.paginas > 1 && (
        <div className="paginacao">
          <button className="botao botao-secundario botao-pequeno" type="button" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <span className="texto-suave">
            Página {dados.pagina} de {dados.paginas}
          </span>
          <button
            className="botao botao-secundario botao-pequeno"
            type="button"
            disabled={pagina >= dados.paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
