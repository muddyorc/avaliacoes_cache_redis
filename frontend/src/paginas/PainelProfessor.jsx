// Tela inicial do professor (RF06).
//
// Mesma ideia da tela inicial do estudante: o professor chega e vê as **turmas** dele em
// cartões, com o que cada uma tem de pendente, e pode criar uma turma dali mesmo.
//
// Os dados vêm de `GET /api/turmas`, a mesma rota da tela de gerenciamento — nenhuma rota
// nova, nenhuma regra alterada. A administração completa (editar, código, solicitações,
// inativar) continua em "Turmas", na navegação lateral.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/ContextoAuth.jsx';
import { Aviso } from '../componentes/Aviso.jsx';
import { Carregando } from '../componentes/Carregando.jsx';
import { EstadoVazio } from '../componentes/EstadoVazio.jsx';
import { Layout } from '../componentes/Layout.jsx';
import { primeiroNome } from '../utils/texto.js';
import { IconeMais, IconeTurma } from '../componentes/Icones.jsx';

const plural = (n, singular, plural_) => `${n} ${n === 1 ? singular : plural_}`;

function CartaoTurma({ turma }) {
  return (
    <Link className="cartao-turma" to={`/professor/turmas/${turma.id}`}>
      <div className="cartao-turma-capa">
        <span className="cartao-turma-nome">{turma.nome}</span>
        <span className="cartao-turma-professor">
          {plural(turma.totalEstudantes, 'estudante', 'estudantes')}
        </span>
      </div>
      <div className="cartao-turma-corpo">
        {/* Pendência primeiro: é o que pede ação do professor. */}
        {turma.totalPendentes > 0 && (
          <span className="etiqueta-alerta">
            {plural(turma.totalPendentes, 'solicitação aguardando', 'solicitações aguardando')}
          </span>
        )}
        <span className="cartao-turma-dados">
          <span>{plural(turma.totalAvaliacoes, 'avaliação', 'avaliações')}</span>
          <span>{turma.requerAprovacao ? 'Entrada com aprovação' : 'Entrada direta'}</span>
        </span>
        {turma.descricao && <span className="quebra">{turma.descricao}</span>}
      </div>
    </Link>
  );
}

export function PainelProfessor() {
  const { usuario } = useAuth();
  const [turmas, setTurmas] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    api('/turmas')
      .then((resposta) => ativo && setTurmas(resposta.turmas))
      .catch((falha) => ativo && setErro(falha.message));
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <Layout titulo="Início do professor">
      <div className="conteudo-central">
        <div className="saudacao">
          <h1>Olá, {primeiroNome(usuario.nome)}</h1>
          <p>Suas turmas em um só lugar.</p>
        </div>

        <Aviso tipo="erro">{erro}</Aviso>
        {!turmas && !erro && <Carregando mensagem="Carregando suas turmas…" />}

        {turmas && (
          <section>
            <div className="secao-topo">
              <div>
                <h2>Minhas turmas</h2>
                <p>Turmas ativas. Abra uma para ver os estudantes, o código e as avaliações.</p>
              </div>
              <Link className="link-acao" to="/professor/turmas">
                Gerenciar turmas
              </Link>
            </div>

            {turmas.length === 0 ? (
              <div className="cartao">
                <EstadoVazio
                  Icone={IconeTurma}
                  titulo="Você ainda não criou nenhuma turma"
                  acao={
                    <Link className="botao" to="/professor/turmas/nova">
                      Criar turma
                    </Link>
                  }
                >
                  A turma reúne os estudantes e recebe as avaliações. Ao criar, o sistema gera um
                  código de acesso para você entregar à turma.
                </EstadoVazio>
              </div>
            ) : (
              <ul className="grade-cartoes">
                {turmas.map((t) => (
                  <li key={t.id}>
                    <CartaoTurma turma={t} />
                  </li>
                ))}
                {/* O convite para criar fica no fim da grade, como mais um cartão. */}
                <li>
                  <Link className="cartao-adicionar" to="/professor/turmas/nova">
                    <IconeMais aria-hidden="true" />
                    Criar turma
                  </Link>
                </li>
              </ul>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}
