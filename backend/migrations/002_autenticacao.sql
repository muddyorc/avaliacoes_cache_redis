-- 002_autenticacao.sql
-- Etapa 1 (RF01). Ajusta o registro de acesso para cobrir TENTATIVAS de autenticação,
-- e não apenas os acessos bem-sucedidos.
--
-- Motivo: a migração 001 modelou `registro_acesso` a partir da pós-condição do UC01
-- ("o sistema registra o acesso realizado"), com `usuario_id` obrigatório. Uma tentativa
-- com e-mail inexistente não tem usuário para referenciar, e uma tentativa com senha
-- errada precisa ser distinguida de um acesso válido. Sem estas colunas não é possível
-- auditar falhas de autenticação nem sustentar o rate limiting.
--
-- Nenhum dado é apagado: os registros existentes continuam válidos e viram `sucesso = TRUE`
-- (a tabela só era gravada em acessos bem-sucedidos). Registros de acesso nunca são
-- removidos fisicamente (DERS Quadro 31, P-02).
--
-- Idempotente: pode ser reexecutada sem efeito colateral.

-- Tentativa com e-mail inexistente não tem usuário: a coluna passa a aceitar NULL.
ALTER TABLE registro_acesso ALTER COLUMN usuario_id DROP NOT NULL;

-- Resultado da tentativa. DEFAULT TRUE preserva a semântica das linhas já gravadas.
ALTER TABLE registro_acesso ADD COLUMN IF NOT EXISTS sucesso BOOLEAN NOT NULL DEFAULT TRUE;

-- Motivo da falha, para auditoria. NULL quando `sucesso = TRUE`.
ALTER TABLE registro_acesso ADD COLUMN IF NOT EXISTS motivo TEXT
  CHECK (motivo IS NULL OR motivo IN ('CREDENCIAIS_INVALIDAS', 'CONTA_INATIVA'));

-- E-mail digitado na tentativa: única pista quando o usuário não existe.
-- Nunca guarda senha nem qualquer derivado dela.
ALTER TABLE registro_acesso ADD COLUMN IF NOT EXISTS email_informado TEXT;

ALTER TABLE registro_acesso ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Consultas de histórico são sempre por período (mais recentes primeiro).
CREATE INDEX IF NOT EXISTS registro_acesso_data_hora_idx ON registro_acesso (data_hora DESC);

-- Busca do token válido de um usuário durante a redefinição de senha (UC01 A2).
CREATE INDEX IF NOT EXISTS token_redefinicao_usuario_idx ON token_redefinicao_senha (usuario_id);
