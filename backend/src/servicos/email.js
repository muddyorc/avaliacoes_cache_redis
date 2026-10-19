// Serviço de e-mail (componente "Serviços de Apoio" do DERS, Fig. 8).
//
// SMTP é configurado por variáveis de ambiente (P-11). Quando SMTP_HOST está vazio —
// situação normal em desenvolvimento local — o e-mail NÃO é enviado: o conteúdo é
// impresso no log do servidor (DT11). Isso permite testar o fluxo completo de
// recuperação de senha sem depender de serviço externo, sem nunca expor o link
// em uma resposta da API.
import nodemailer from 'nodemailer';
import { env, emProducao } from '../config/env.js';

export const smtpConfigurado = Boolean(env.smtp.host);

let transporte = null;

function obterTransporte() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.porta,
      secure: env.smtp.porta === 465,
      auth: env.smtp.usuario ? { user: env.smtp.usuario, pass: env.smtp.senha } : undefined,
      // Tempos limite explicitos (18/10/2026). Sem eles o `nodemailer` espera
      // indefinidamente, e como o envio e aguardado dentro da requisicao, a tela de
      // recuperacao ficava em "Enviando..." para sempre -- sem erro, sem log, sem nada.
      //
      // O caso real que expos isso: hospedagem que bloqueia a saida na porta de SMTP. O
      // TCP nunca completa, entao nao ha falha para capturar; so silencio. Com limite, a
      // tentativa morre em dez segundos e o motivo aparece no log.
      //
      // Senha errada, em comparacao, falha em dois segundos. A diferenca entre os dois
      // tempos e o que distingue "credencial invalida" de "porta bloqueada".
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporte;
}

// Envia (ou registra no log) uma mensagem. Nunca lança: uma falha de SMTP não pode
// derrubar o fluxo de recuperação nem revelar ao cliente se o e-mail existe.
export async function enviarEmail({ para, assunto, texto }) {
  if (!smtpConfigurado) {
    if (emProducao) {
      console.error('[email] SMTP não configurado em produção — mensagem NÃO enviada para', para);
      return { enviado: false, motivo: 'smtp-ausente' };
    }
    console.log(
      `\n[email] SMTP não configurado — mensagem registrada no log (somente desenvolvimento)\n` +
        `        Para: ${para}\n        Assunto: ${assunto}\n${texto}\n`,
    );
    return { enviado: false, motivo: 'log-desenvolvimento' };
  }

  try {
    await obterTransporte().sendMail({ from: env.smtp.remetente, to: para, subject: assunto, text: texto });
    return { enviado: true };
  } catch (erro) {
    // `code` diz mais que a mensagem: ETIMEDOUT e ECONNREFUSED apontam rede ou porta
    // bloqueada; EAUTH aponta credencial. Sem ele, os dois casos parecem iguais no log.
    console.error("[email] falha ao enviar para", para, "-", erro.code || "", erro.message);
    return { enviado: false, motivo: 'falha-envio' };
  }
}

export function montarEmailDeRedefinicao({ nome, link, validadeMinutos }) {
  return {
    assunto: 'Redefinição de senha — Sistema de Avaliações',
    texto:
      `Olá, ${nome}.\n\n` +
      `Recebemos um pedido para redefinir a senha da sua conta.\n` +
      `Acesse o link abaixo para cadastrar uma nova senha:\n\n${link}\n\n` +
      `O link vale por ${validadeMinutos} minutos e pode ser usado uma única vez.\n` +
      `Se você não solicitou a redefinição, ignore esta mensagem: sua senha atual continua valendo.\n`,
  };
}
