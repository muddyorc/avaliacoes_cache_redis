// UC06 A2/A3 — o estudante entra em turmas pelo código e acompanha as solicitações.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { formatarDataHora } from '../utils/datas.js';
import { Campo } from '../componentes/Campo.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { CancelarInscricao } from '../componentes/CancelarInscricao.jsx';
import { Layout } from '../componentes/Layout.jsx';

const SITUACAO = {
  APROVADA: { rotulo: 'Participando', classe: 'selo-status-publicada' },
  PENDENTE: { rotulo: 'Aguardando o professor', classe: 'selo-alerta' },
  RECUSADA: { rotulo: 'Solicitação recusada', classe: 'selo-status-arquivada' },
  // Quem foi removido pelo professor continua vendo a turma aqui, marcada. Quem saiu por
  // conta própria sabe que saiu; quem foi removido não saberia de nada — a turma
  // desapareceria da lista sem explicação nenhuma.
  SAIU: { rotulo: 'Removido da turma', classe: 'selo-status-arquivada' },
};

export function MinhasTurmas() {
  const [dados, setDados] = useState(null);
  const [erroLista, setErroLista] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [campos, setCampos] = useState({});
  const [mensagem, setMensagem] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await api('/estudante/turmas'));
    } catch (falha) {
      setErroLista(falha.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function entrar(evento) {
    evento.preventDefault();
    setErro('');
    setCampos({});
    setMensagem('');
    setEnviando(true);
    try {
      const r = await api('/estudante/turmas/entrar', { metodo: 'POST', corpo: { codigo } });
      setMensagem(r.mensagem);
      setCodigo('');
      await carregar();
    } catch (falha) {
      setErro(falha.message);
      setCampos(falha.campos || {});
    } finally {
      setEnviando(false);
    }
  }

  return (
    // Dentro do Layout: esta tela está no menu lateral, e abri-la fazia o menu sumir —
    // o próprio caminho que trouxe o estudante até aqui desaparecia.
    <Layout>
      <div className="conteudo-central">
      <header className="cabecalho cabecalho-barra">
        <div>
          <h1>Minhas turmas</h1>
          <p>Entre em uma turma com o código que o professor passou.</p>
        </div>
        {/* O menu lateral já leva ao início; este botão nomeia o destino em vez de dizer
            só "Voltar", que não diz para onde. */}
        <Link className="botao botao-secundario" to="/estudante">
          Ir para o início
        </Link>
      </header>

      <section className="painel">
        <h2>Entrar em uma turma</h2>
        <form className="linha-entrada" onSubmit={entrar} noValidate>
          <Campo
            id="codigo"
            rotulo="Código da turma"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            value={codigo}
            erro={campos.codigo}
            dica="8 letras e números. Maiúsculas, espaços e hífen não importam."
            onChange={(e) => setCodigo(e.target.value)}
          />
          <button className="botao" type="submit" disabled={enviando || !codigo.trim()}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        {/* Erro sem campo específico (ex.: "já participa") aparece abaixo do formulário. */}
        {!campos.codigo && <Aviso tipo="erro">{erro}</Aviso>}
        <Aviso tipo="sucesso">{mensagem}</Aviso>
      </section>

      <section className="painel espaco-acima">
        <h2>Turmas</h2>
        <Aviso tipo="erro">{erroLista}</Aviso>
        {!dados && !erroLista && <Carregando />}
        {dados &&
          (dados.turmas.length === 0 ? (
            <p className="texto-suave">Você ainda não está em nenhuma turma.</p>
          ) : (
            // `lista-questoes` + `cartao-questao`, os mesmos cartões da lista de turmas
            // do professor e da lista de provas. Antes isto usava `lista-pessoas`, um
            // layout feito para linhas de nome e e-mail: a turma saía como um link solto
            // com três parágrafos embaixo, e o selo e o menu caíam numa quarta linha
            // encostados um no outro. Mesma informação, na forma que o resto do sistema
            // já usa para "um objeto por cartão".
            <ul className="lista-questoes">
              {dados.turmas.map((t) => (
                <li key={t.id} className={`cartao-questao${t.turmaAtiva ? '' : ' cartao-inativo'}`}>
                  <div className="cartao-meta">
                    <span className={`selo ${SITUACAO[t.situacao].classe}`}>{SITUACAO[t.situacao].rotulo}</span>
                    {!t.turmaAtiva && <span className="texto-suave">Turma encerrada</span>}
                  </div>

                  {/* A turma tem tela própria, com as provas vinculadas a ela. */}
                  <p className="cartao-titulo">
                    <Link to={`/estudante/turmas/${t.id}`}>{t.nome}</Link>
                  </p>
                  <p className="texto-suave cartao-uso">Professor: {t.professor}</p>
                  {t.descricao && <p className="texto-suave cartao-uso">{t.descricao}</p>}

                  {t.removido && (
                    <p className="cartao-aviso">
                      Você foi removido desta turma pelo professor
                      {t.saiuEm ? ` em ${formatarDataHora(t.saiuEm)}` : ''}. As notas das provas que você já fez
                      continuam no seu histórico.
                    </p>
                  )}

                  <div className="acoes espaco-acima-pequeno">
                    <Link className="botao botao-secundario botao-pequeno" to={`/estudante/turmas/${t.id}`}>
                      Abrir
                    </Link>
                    {/* Solicitação recusada não tem inscrição a cancelar. */}
                    {t.situacao !== 'RECUSADA' && t.situacao !== 'SAIU' && (
                      <CancelarInscricao
                        turma={t}
                        aoSair={(aviso) => {
                          setMensagem(aviso);
                          setErro('');
                          carregar();
                        }}
                        aoFalhar={setErro}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </section>
      </div>
    </Layout>
  );
}
