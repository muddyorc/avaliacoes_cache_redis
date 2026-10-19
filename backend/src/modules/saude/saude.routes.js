// GET /api/saude — verifica a cadeia API → PostgreSQL (Etapa 0).
//
// Rota PÚBLICA, e precisa continuar assim: é o `healthCheckPath` do Render, consultado
// sem sessão. Se exigir autenticação, o serviço é considerado fora do ar e não sobe.
//
// Por isso a resposta diz apenas SE as camadas respondem, e não o que elas são. Versão do
// PostgreSQL e migrações aplicadas saíram daqui: numa página aberta a qualquer um, a versão
// exata do banco só ajuda quem procura vulnerabilidade conhecida daquela versão. Quem
// precisa desse detalhe tem o log do servidor, que já exige acesso.
import { Router } from 'express';
import { query } from '../../db/pool.js';

export const rotasSaude = Router();

rotasSaude.get('/', async (req, res) => {
  const horaServidor = new Date().toISOString();
  try {
    // Uma consulta de verdade, e não apenas "a conexão abriu": o que interessa é se o
    // banco responde a uma pergunta.
    await query('SELECT 1');
    res.json({
      status: 'ok',
      api: { online: true, horaServidor },
      banco: { conectado: true },
    });
  } catch (erro) {
    console.error('[saude] falha ao consultar o banco:', erro.message);
    res.status(503).json({
      status: 'degradado',
      erro: 'A API está online, mas não conseguiu consultar o banco de dados.',
      api: { online: true, horaServidor },
      banco: { conectado: false },
    });
  }
});
