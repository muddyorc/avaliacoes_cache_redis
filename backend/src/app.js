// Monta a aplicação Express (sem abrir porta — isso fica em server.js, o que permite testar com supertest).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { rotasSaude } from './modules/saude/saude.routes.js';
import { criarRotasAuth } from './modules/auth/auth.routes.js';
import { criarRotasUsuarios } from './modules/usuarios/usuarios.routes.js';
import { rotasQuestoes } from './modules/questoes/questoes.routes.js';
import { rotasAvaliacoes } from './modules/avaliacoes/avaliacoes.routes.js';
import { rotasTurmas, criarRotasTurmasDoEstudante } from './modules/turmas/turmas.routes.js';
import { rotasRealizacao } from './modules/realizacao/realizacao.routes.js';
import { rotasCorrecao } from './modules/correcao/correcao.routes.js';
import { rotasDashboard } from './modules/dashboard/dashboard.routes.js';
import { rotasResultados } from './modules/resultados/resultados.routes.js';
import { rotasMonitoramento, rotasMonitoramentoEstudante } from './modules/monitoramento/monitoramento.routes.js';
import { rotasPainel } from './modules/painel/painel.routes.js';
import { rotaNaoEncontrada, tratarErros } from './middleware/erros.js';

// `opcoes.limites` sobrescreve os limites de rate limiting (usado pelos testes).
export function criarApp(opcoes = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // IP real do cliente atrás do proxy do Vite/Nginx (registro_acesso)
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser()); // lê o cookie httpOnly da sessão (Etapa 1)

  // Rotas da API — cada módulo de domínio é registrado aqui conforme as etapas avançam.
  app.use('/api/saude', rotasSaude);
  app.use('/api/auth', criarRotasAuth(opcoes));
  app.use('/api/usuarios', criarRotasUsuarios(opcoes));
  app.use('/api/questoes', rotasQuestoes);
  app.use('/api/avaliacoes', rotasAvaliacoes);
  app.use('/api/turmas', rotasTurmas);
  app.use('/api/estudante/turmas', criarRotasTurmasDoEstudante(opcoes));
  app.use('/api/estudante/avaliacoes', rotasMonitoramentoEstudante);
  app.use('/api/estudante/avaliacoes', rotasRealizacao);
  app.use('/api/correcao', rotasCorrecao);
  app.use('/api/dashboard', rotasDashboard);
  app.use('/api/resultados', rotasResultados);
  app.use('/api/monitoramento', rotasMonitoramento);
  app.use('/api/painel', rotasPainel);

  app.use('/api', rotaNaoEncontrada);

  // ------------------------------------------------- o site, servido pela própria API
  //
  // Em desenvolvimento são dois servidores: o Vite na 5173 e esta API na 3000, com o
  // proxy do Vite ligando os dois. Em produção o Vite não existe — e hospedar o site
  // separado criaria **outra origem**, o que faria o navegador deixar de enviar o cookie
  // de sessão (`SameSite=Strict`): o login responderia 200 e a requisição seguinte
  // chegaria sem sessão. Servir os dois daqui mantém a mesma origem de sempre (DT04).
  //
  // O build só é servido se existir: em desenvolvimento e nos testes a pasta não está lá,
  // e a aplicação precisa subir do mesmo jeito.
  const siteConstruido = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist');
  if (existsSync(join(siteConstruido, 'index.html'))) {
    // Os arquivos com hash no nome podem ser guardados para sempre; o `index.html`, nunca
    // — é ele que aponta para a versão nova depois de cada publicação.
    app.use(express.static(siteConstruido, { index: false, maxAge: '1y' }));

    // Qualquer caminho que não seja da API devolve o `index.html`: as rotas do React
    // existem só no navegador, e sem isto recarregar `/professor/turmas` daria 404.
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(siteConstruido, 'index.html')));
  }

  app.use(tratarErros);

  return app;
}
