// Diagnóstico do ambiente: prova a cadeia Interface → API → PostgreSQL (Etapa 0).
// Continua disponível em /diagnostico como ferramenta de verificação do ambiente;
// a tela inicial do sistema passou a ser o login na Etapa 1.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

function formatarHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function LinhaStatus({ nome, estado, detalhe }) {
  const rotulo = { ok: 'Funcionando', falha: 'Com falha', verificando: 'Verificando…' }[estado];
  return (
    <li className="status-linha">
      <span className={`status-indicador status-${estado}`} aria-hidden="true" />
      <div>
        <strong>{nome}</strong>
        <span className="status-rotulo">{rotulo}</span>
        {detalhe && <p className="status-detalhe">{detalhe}</p>}
      </div>
    </li>
  );
}

export function Diagnostico() {
  const [situacao, setSituacao] = useState({ estado: 'verificando' });

  const verificar = useCallback(async () => {
    setSituacao({ estado: 'verificando' });
    try {
      const dados = await api('/saude');
      setSituacao({ estado: 'ok', dados });
    } catch (erro) {
      setSituacao({ estado: 'falha', erro });
    }
  }, []);

  useEffect(() => {
    verificar();
  }, [verificar]);

  const { estado, dados, erro } = situacao;
  const apiOnline = estado === 'ok' || (erro && erro.status !== 0);

  return (
    <main className="pagina">
      <header className="cabecalho">
        <h1>Avaliações Digitais</h1>
        <p>Diagnóstico do ambiente de desenvolvimento</p>
      </header>

      <section aria-live="polite" className="painel">
        <ul className="status-lista">
          <LinhaStatus nome="Interface (React)" estado="ok" detalhe="Esta página foi carregada pelo Vite." />
          <LinhaStatus
            nome="API (Node.js + Express)"
            estado={estado === 'verificando' ? 'verificando' : apiOnline ? 'ok' : 'falha'}
            detalhe={
              estado === 'ok'
                ? `Hora do servidor: ${formatarHora(dados.api.horaServidor)}`
                : !apiOnline && erro ? erro.message : null
            }
          />
          <LinhaStatus
            nome="Banco de dados (PostgreSQL)"
            estado={estado === 'verificando' ? 'verificando' : estado === 'ok' ? 'ok' : 'falha'}
            detalhe={
              // Só se o banco responde. Versão e migrações não aparecem aqui: esta página
              // é pública, e o que ela precisa responder é "as três camadas estão de pé?".
              estado === 'ok'
                ? 'Conectado e respondendo.'
                : apiOnline && erro ? erro.message : null
            }
          />
        </ul>

        <button type="button" className="botao" onClick={verificar} disabled={estado === 'verificando'}>
          Verificar novamente
        </button>

        <p className="rodape-form">
          <Link to="/entrar">Ir para o login</Link>
        </p>
      </section>
    </main>
  );
}
