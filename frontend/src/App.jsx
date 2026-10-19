// Rotas da aplicação (Etapa 1 — RF01).
//
// Só existem as telas necessárias ao fluxo de autenticação. As áreas por perfil são
// placeholders que serão substituídos pelo conteúdo real nas etapas seguintes.
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { ProvedorAuth, useAuth, caminhoInicial } from './auth/ContextoAuth.jsx';
import { RotaProtegida, RotaPublica } from './auth/RotaProtegida.jsx';
import { Carregando } from './componentes/Carregando.jsx';
import { LimiteDeErro } from './componentes/LimiteDeErro.jsx';
import { Login } from './paginas/Login.jsx';
import { Cadastro } from './paginas/Cadastro.jsx';
import { RecuperarSenha } from './paginas/RecuperarSenha.jsx';
import { RedefinirSenha } from './paginas/RedefinirSenha.jsx';
import { Painel } from './paginas/Painel.jsx';
import { PainelEstudante } from './paginas/PainelEstudante.jsx';
import { PainelProfessor } from './paginas/PainelProfessor.jsx';
import { TurmaEstudante } from './paginas/TurmaEstudante.jsx';
import { Usuarios } from './paginas/Usuarios.jsx';
import { MeusDados } from './paginas/MeusDados.jsx';
import { Questoes } from './paginas/Questoes.jsx';
import { EditorAvaliacao } from './paginas/EditorAvaliacao.jsx';
import { TesteAvaliacao } from './paginas/TesteAvaliacao.jsx';
import { CorrigirTentativa } from './paginas/CorrigirTentativa.jsx';
import { Turmas } from './paginas/Turmas.jsx';
import { EditorTurma } from './paginas/EditorTurma.jsx';
import { TurmaProfessor } from './paginas/TurmaProfessor.jsx';
import { MinhasTurmas } from './paginas/MinhasTurmas.jsx';
import { MinhasAvaliacoes } from './paginas/MinhasAvaliacoes.jsx';
import { RealizarAvaliacao } from './paginas/RealizarAvaliacao.jsx';
import { Diagnostico } from './paginas/Diagnostico.jsx';
import { NaoEncontrada } from './paginas/NaoEncontrada.jsx';

// O dashboard é a única tela que usa a biblioteca de gráficos, e ela sozinha dobra o
// tamanho do pacote. Carregada sob demanda, o peso fica só para quem abre o painel — o
// login e a realização da prova continuam leves (RNF03).
const Dashboard = lazy(() => import('./paginas/Dashboard.jsx').then((m) => ({ default: m.Dashboard })));

// "/" manda cada um para o seu lugar: a área do perfil, se autenticado; o login, se não.
function Inicio() {
  const { usuario, carregando } = useAuth();
  if (carregando) return <Carregando mensagem="Verificando sua sessão…" />;
  return <Navigate to={usuario ? caminhoInicial(usuario) : '/entrar'} replace />;
}

// O endereço antigo de "Resultados" leva ao painel de desempenho, mantendo a turma.
function IrParaDesempenho() {
  const [parametros] = useSearchParams();
  const turma = parametros.get('turma');
  return (
    <Navigate to={turma ? `/professor/dashboard?turma=${turma}&fixa=1` : '/professor/dashboard'} replace />
  );
}

// Leva ao editor da avaliação já na aba de correção. `replace` para que o botão Voltar
// do navegador não devolva o usuário ao endereço antigo, que o traria de volta para cá.
function IrParaCorrecao() {
  const { id } = useParams();
  return <Navigate to={`/professor/avaliacoes/${id}?aba=correcao`} replace />;
}

export default function App() {
  // A rota é a chave do limite de erro: trocar de tela limpa a falha da tela anterior,
  // sem obrigar o usuário a recarregar para sair de lá.
  const { pathname } = useLocation();
  return (
    <ProvedorAuth>
      <LimiteDeErro chave={pathname}>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/diagnostico" element={<Diagnostico />} />

        {/* O link de redefinição vale por si (traz o token do e-mail) e não depende de
            haver sessão: quem está logado em outro dispositivo, ou já entrou nesta aba,
            precisa conseguir abri-lo mesmo assim. Por isso fica fora da guarda. */}
        <Route path="/redefinir-senha" element={<RedefinirSenha />} />

        {/* Telas de quem ainda não entrou; quem já entrou é redirecionado. */}
        <Route element={<RotaPublica />}>
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Cadastro />} />
          <Route path="/recuperar-senha" element={<RecuperarSenha />} />
        </Route>

        {/* Disponível para qualquer perfil autenticado (UC03). */}
        <Route element={<RotaProtegida />}>
          <Route path="/meus-dados" element={<MeusDados />} />
        </Route>

        {/* Áreas por perfil. A guarda aqui é de navegação: quem protege é o backend. */}
        <Route element={<RotaProtegida perfis={['ADMINISTRADOR']} />}>
          <Route path="/administrador" element={<Painel recurso="/painel/administrador" />} />
          <Route path="/administrador/usuarios" element={<Usuarios />} />
        </Route>
        <Route element={<RotaProtegida perfis={['PROFESSOR']} />}>
          <Route path="/professor" element={<PainelProfessor />} />
          <Route path="/professor/questoes" element={<Questoes />} />
          {/* A listagem de avaliações deixou de existir: a prova mora na turma. O
              endereço antigo leva às turmas, que é onde as provas estão agora. */}
          <Route path="/professor/avaliacoes" element={<Navigate to="/professor/turmas" replace />} />
          <Route path="/professor/avaliacoes/nova" element={<EditorAvaliacao />} />
          <Route path="/professor/avaliacoes/:id" element={<EditorAvaliacao />} />
          <Route path="/professor/avaliacoes/:id/teste" element={<TesteAvaliacao />} />
          {/* Correção e monitoramento viraram uma aba do editor (item 9 do feedback do
              orientador): eram duas telas com as MESMAS linhas e colunas diferentes. Os
              endereços antigos continuam válidos e levam para lá — há links deles em
              telas já mostradas ao orientador, e quebrá-los não traria ganho nenhum. */}
          <Route path="/professor/avaliacoes/:id/monitoramento" element={<IrParaCorrecao />} />
          <Route path="/professor/avaliacoes/:id/correcao" element={<IrParaCorrecao />} />
          <Route path="/professor/avaliacoes/:id/correcao/:tentativaId" element={<CorrigirTentativa />} />
          <Route
            path="/professor/dashboard"
            element={
              <Suspense fallback={<Carregando mensagem="Abrindo o dashboard…" />}>
                <Dashboard />
              </Suspense>
            }
          />
          {/* "Resultados" (RF13) virou seção do painel de desempenho (item 3 do
              feedback). O endereço antigo continua válido e leva ao painel, preservando
              a turma que viesse na URL. */}
          <Route path="/professor/resultados" element={<IrParaDesempenho />} />

          {/* A tela de histórico de UM estudante na turma foi removida em 15/10/2026: ela
              respondia "um estudante × várias provas", recorte que o próprio autor
              descartou ao tirar as agregações entre provas do dashboard. O caminho útil a
              partir dos números de uma prova é a prova daquele estudante, e é para lá que
              o nome leva agora. */}
          <Route path="/professor/turmas" element={<Turmas />} />
          <Route path="/professor/turmas/nova" element={<EditorTurma />} />
          {/* Abrir a turma mostra a turma; editar é uma ação dentro dela. */}
          <Route path="/professor/turmas/:id" element={<TurmaProfessor />} />
          <Route path="/professor/turmas/:id/editar" element={<EditorTurma />} />
        </Route>
        <Route element={<RotaProtegida perfis={['ESTUDANTE']} />}>
          <Route path="/estudante" element={<PainelEstudante />} />
          <Route path="/estudante/turmas" element={<MinhasTurmas />} />
          <Route path="/estudante/turmas/:id" element={<TurmaEstudante />} />
          <Route path="/estudante/avaliacoes" element={<MinhasAvaliacoes />} />
          <Route path="/estudante/avaliacoes/:id" element={<RealizarAvaliacao />} />
        </Route>

        <Route path="*" element={<NaoEncontrada />} />
      </Routes>
      </LimiteDeErro>
    </ProvedorAuth>
  );
}
