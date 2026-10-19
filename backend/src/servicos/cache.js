// Cache de leitura em Redis — camada nova do Projeto N2.
//
// A regra que governa este arquivo inteiro: **o cache nunca pode derrubar nem atrasar a
// API**. Ele é um atalho para uma leitura que o PostgreSQL já sabe responder. Por isso
// nenhuma função daqui lança exceção para quem chamou: falha de rede, Redis fora do ar,
// JSON corrompido — tudo vira "não achei", e o chamador segue para a fonte da verdade.
//
// Estratégia: cache-aside. Quem lê procura aqui primeiro; no vazio (MISS) vai ao banco e
// guarda o resultado. Quem escreve grava no banco primeiro e só então invalida a chave —
// a ordem inversa deixaria uma leitura concorrente repovoar o cache com o dado velho.
//
// O QUE NÃO ESTÁ AQUI, de propósito: a decisão de *o que* pode ser cacheado. Este módulo
// é um armário burro — ele guarda e devolve. Quem sabe que a estrutura de uma prova
// congelada é imutável é o módulo de realização, que é quem conhece a regra.
import { createClient } from 'redis';
import { env } from '../config/env.js';

// Um cliente por processo. O node-redis multiplexa comandos na mesma conexão, então abrir
// um cliente por requisição só gastaria handshake e descritor de arquivo.
let cliente = null;
// Promessa de conexão em voo, para que N requisições simultâneas no início da prova
// abram UMA conexão, e não N.
let abrindo = null;
// Instante até o qual nem tentamos falar com o Redis (ver `esperaAposFalhaMs`).
let silencioAte = 0;
// O aviso de indisponibilidade sai uma vez por queda, não a cada requisição: um log que
// repete 200 vezes por segundo esconde justamente o problema que ele deveria mostrar.
// Volta a false quando uma conexão dá certo, para que a queda seguinte seja avisada.
let avisou = false;

// `erro.message` do node-redis vem VAZIO em algumas falhas de socket — a queda emitida
// depois de a conexão já ter sido recusada, por exemplo. Um log dizendo
// "Redis indisponível ()" não ajuda ninguém a diagnosticar nada, então cai para o código
// do erro, o nome da classe e, no limite, uma descrição genérica.
function descrever(erro) {
  return erro?.message || erro?.code || erro?.name || 'conexão perdida';
}

function adormecer(motivo) {
  silencioAte = Date.now() + env.cache.esperaAposFalhaMs;
  if (!avisou) {
    const segundos = Math.round(env.cache.esperaAposFalhaMs / 1000);
    console.warn(
      `[cache] Redis indisponível (${motivo}). Lendo direto do PostgreSQL; ` +
        `nova tentativa em ${segundos}s.`,
    );
    avisou = true;
  }
}

// Devolve um cliente pronto, ou null quando o cache está desligado, dormindo ou fora do ar.
function conectar() {
  if (!env.cache.ativo) return Promise.resolve(null);
  if (cliente?.isReady) return Promise.resolve(cliente);
  if (abrindo) return abrindo;
  if (Date.now() < silencioAte) return Promise.resolve(null);

  abrindo = abrir().finally(() => {
    abrindo = null;
  });
  return abrindo;
}

async function abrir() {
  try {
    const novo = createClient({
      url: env.cache.url,
      socket: {
        connectTimeout: env.cache.esperaConexaoMs,
        // Quem decide quando tentar de novo é a pausa deste módulo, não o cliente. Com a
        // reconexão automática ligada, uma queda do Redis viraria uma tempestade de
        // tentativas em segundo plano, cada comando ficaria pendurado na fila interna do
        // node-redis esperando a volta, e a API herdaria a lentidão do cache.
        reconnectStrategy: false,
      },
    });

    // Sem este ouvinte, um erro de socket emitido FORA de uma chamada nossa derruba o
    // processo: 'error' sem ouvinte num EventEmitter é exceção não tratada. Foi o mesmo
    // cuidado tomado com o pool do PostgreSQL (db/pool.js).
    novo.on('error', (erro) => {
      cliente = null;
      adormecer(descrever(erro));
    });

    await novo.connect();
    cliente = novo;
    avisou = false;
    return novo;
  } catch (erro) {
    cliente = null;
    adormecer(descrever(erro));
    return null;
  }
}

// Lê e desserializa. Devolve null em qualquer situação que não seja um acerto limpo —
// inclusive JSON corrompido, que é tratado como MISS em vez de erro: um valor ilegível no
// cache não pode impedir o estudante de abrir a prova.
export async function buscar(chave) {
  const atual = await conectar();
  if (!atual) return null;
  try {
    const bruto = await atual.get(chave);
    return bruto === null ? null : JSON.parse(bruto);
  } catch (erro) {
    adormecer(descrever(erro));
    return null;
  }
}

// Guarda com validade. O retorno (true/false) existe para os testes e para diagnóstico;
// nenhum fluxo de negócio deve mudar de rumo porque o cache não aceitou gravar.
export async function guardar(chave, valor, ttlSegundos) {
  const atual = await conectar();
  if (!atual) return false;
  try {
    await atual.setEx(chave, ttlSegundos, JSON.stringify(valor));
    return true;
  } catch (erro) {
    adormecer(descrever(erro));
    return false;
  }
}

// Apaga a chave. Chamado DEPOIS da gravação na fonte da verdade — ver o comentário do
// topo sobre a ordem.
export async function invalidar(chave) {
  const atual = await conectar();
  if (!atual) return false;
  try {
    await atual.del(chave);
    return true;
  } catch (erro) {
    adormecer(descrever(erro));
    return false;
  }
}

// Encerra a conexão. Usado pelos testes e por quem quiser desligar o processo sem deixar
// socket aberto. `destroy` em vez de `quit`: não há comando em voo que valha esperar.
export async function encerrar() {
  const atual = cliente;
  cliente = null;
  abrindo = null;
  if (!atual) return;
  try {
    atual.destroy();
  } catch {
    // Já estava fechado. Encerrar não pode falhar.
  }
}

// Zera a pausa. Existe para os testes, que trocam a URL entre casos e precisam que a
// próxima chamada realmente tente conectar em vez de respeitar uma pausa anterior.
//
// NÃO mexe em `avisou` de propósito: se mexesse, cada caso de teste produziria uma linha
// idêntica de aviso e a saída da suíte viraria dez repetições da mesma informação.
export function esquecerFalhas() {
  silencioAte = 0;
}

// Diagnóstico: diz se há conexão viva agora, sem tentar abrir nenhuma.
export function disponivel() {
  return Boolean(cliente?.isReady);
}

// Diagnóstico: diz se o módulo está na pausa pós-falha. Exposto para que o teste da
// degradação verifique o COMPORTAMENTO ("desistiu de tentar") em vez de cronometrar
// chamadas — medida de tempo em teste é a receita de falha intermitente.
export function emPausa() {
  return Date.now() < silencioAte;
}
