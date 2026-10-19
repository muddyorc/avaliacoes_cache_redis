-- 001_schema_inicial.sql
-- Esquema inicial completo, conforme PROJECT_CONTEXT.md §4 e decisões P-01 a P-18.
-- Classes do DERS (Figura 7) → tabelas. Enumerações como TEXT + CHECK (DT10).
-- Nenhuma tabela possui exclusão física pelas funcionalidades do usuário (DERS Quadro 31, P-02).

-- ============================================================
-- USUÁRIOS (RF01, RF02)
-- ============================================================
CREATE TABLE usuario (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome          TEXT NOT NULL CHECK (length(trim(nome)) > 0),
  email         TEXT NOT NULL CHECK (length(trim(email)) > 0),
  senha_hash    TEXT NOT NULL,                       -- bcrypt; nunca texto puro
  perfil        TEXT NOT NULL CHECK (perfil IN ('ADMINISTRADOR', 'PROFESSOR', 'ESTUDANTE')),  -- P-17
  situacao      TEXT NOT NULL DEFAULT 'ATIVO' CHECK (situacao IN ('ATIVO', 'INATIVO')),       -- P-02
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- E-mail único sem diferenciar maiúsculas/minúsculas.
CREATE UNIQUE INDEX usuario_email_unico ON usuario (lower(email));

-- UC01, pós-condição: "o sistema registra o acesso realizado".
CREATE TABLE registro_acesso (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario (id),
  data_hora  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip         TEXT
);
CREATE INDEX registro_acesso_usuario_idx ON registro_acesso (usuario_id);

-- UC01 A2 (recuperação de senha, P-11). Guarda apenas o HASH do token; uso único; expira.
CREATE TABLE token_redefinicao_senha (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuario (id),
  token_hash TEXT NOT NULL UNIQUE,
  expira_em  TIMESTAMPTZ NOT NULL,
  usado_em   TIMESTAMPTZ,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TURMAS (RF06)
-- ============================================================
CREATE TABLE turma (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professor_id     INTEGER NOT NULL REFERENCES usuario (id),     -- "leciona"
  nome             TEXT NOT NULL CHECK (length(trim(nome)) > 0),
  descricao        TEXT,
  codigo_acesso    TEXT NOT NULL UNIQUE,                         -- gerado pelo sistema (UC06)
  requer_aprovacao BOOLEAN NOT NULL DEFAULT FALSE,               -- P-09: entrada direta ou com aprovação
  situacao         TEXT NOT NULL DEFAULT 'ATIVA' CHECK (situacao IN ('ATIVA', 'INATIVA')),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX turma_professor_idx ON turma (professor_id);

-- "participa" + solicitações de entrada (UC06 A2, A3, A4).
CREATE TABLE turma_estudante (
  turma_id      INTEGER NOT NULL REFERENCES turma (id),
  estudante_id  INTEGER NOT NULL REFERENCES usuario (id),
  situacao      TEXT NOT NULL CHECK (situacao IN ('PENDENTE', 'APROVADA', 'RECUSADA')),
  solicitado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em   TIMESTAMPTZ,
  PRIMARY KEY (turma_id, estudante_id)
);
CREATE INDEX turma_estudante_estudante_idx ON turma_estudante (estudante_id);

-- ============================================================
-- BANCO DE QUESTÕES (RF05)
-- ============================================================
CREATE TABLE questao (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professor_id       INTEGER NOT NULL REFERENCES usuario (id),   -- autor/dono
  tipo               TEXT NOT NULL CHECK (tipo IN ('OBJETIVA', 'DISCURSIVA')),
  enunciado          TEXT NOT NULL CHECK (length(trim(enunciado)) > 0),
  tema               TEXT,                                       -- "organizar" (RF05): filtro por tema
  resposta_esperada  TEXT,                                       -- "gabarito" da discursiva (Fig. 7)
  criterios_correcao TEXT,                                       -- discursiva (Fig. 7, UC11)
  pontuacao_padrao   NUMERIC(6, 2) NOT NULL CHECK (pontuacao_padrao > 0),
  situacao           TEXT NOT NULL DEFAULT 'ATIVA' CHECK (situacao IN ('ATIVA', 'INATIVA')),  -- P-02
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX questao_professor_idx ON questao (professor_id);

-- P-03 / P-13: alternativas das objetivas; exatamente uma correta (a regra "pelo menos uma"
-- é validada na API; "no máximo uma" é garantida pelo índice parcial abaixo).
CREATE TABLE alternativa (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  questao_id INTEGER NOT NULL REFERENCES questao (id) ON DELETE CASCADE,
  ordem      SMALLINT NOT NULL CHECK (ordem > 0),
  texto      TEXT NOT NULL CHECK (length(trim(texto)) > 0),
  correta    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (questao_id, ordem)
);
CREATE UNIQUE INDEX alternativa_uma_correta ON alternativa (questao_id) WHERE correta;

-- ============================================================
-- AVALIAÇÕES (RF03, RF04, RF07)
-- ============================================================
CREATE TABLE avaliacao (
  id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  professor_id         INTEGER NOT NULL REFERENCES usuario (id),
  titulo               TEXT NOT NULL CHECK (length(trim(titulo)) > 0),
  descricao            TEXT,                                     -- instruções ao estudante
  duracao_minutos      INTEGER NOT NULL CHECK (duracao_minutos > 0),
  data_inicio          TIMESTAMPTZ NOT NULL,                     -- P-05: período pertence à avaliação
  data_fim             TIMESTAMPTZ NOT NULL,
  -- RF04 distingue "arquivar" de "excluir"; EXCLUIDA = exclusão lógica (P-02, DT14).
  status               TEXT NOT NULL DEFAULT 'RASCUNHO'
                       CHECK (status IN ('RASCUNHO', 'PUBLICADA', 'ARQUIVADA', 'EXCLUIDA')),
  monitoramento_ativo  BOOLEAN NOT NULL DEFAULT TRUE,            -- P-06
  limite_ocorrencias   INTEGER CHECK (limite_ocorrencias IS NULL OR limite_ocorrencias > 0),  -- NULL = nunca bloqueia
  resultados_liberados BOOLEAN NOT NULL DEFAULT FALSE,           -- P-07: ação explícita do professor
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_fim > data_inicio)
);
CREATE INDEX avaliacao_professor_idx ON avaliacao (professor_id);

-- P-01: relação N:N para reutilizar questões do banco. Pontuação pode variar por avaliação.
CREATE TABLE avaliacao_questao (
  avaliacao_id INTEGER NOT NULL REFERENCES avaliacao (id),
  questao_id   INTEGER NOT NULL REFERENCES questao (id),
  ordem        SMALLINT NOT NULL CHECK (ordem > 0),
  pontuacao    NUMERIC(6, 2) NOT NULL CHECK (pontuacao > 0),
  PRIMARY KEY (avaliacao_id, questao_id),
  -- Deferível para permitir reordenar questões dentro de uma transação.
  CONSTRAINT avaliacao_questao_ordem_unica UNIQUE (avaliacao_id, ordem) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX avaliacao_questao_questao_idx ON avaliacao_questao (questao_id);

-- RF07: "vinculada a". PK impede vínculo duplicado (UC07 A2).
CREATE TABLE avaliacao_turma (
  avaliacao_id INTEGER NOT NULL REFERENCES avaliacao (id),
  turma_id     INTEGER NOT NULL REFERENCES turma (id),
  vinculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (avaliacao_id, turma_id)
);
CREATE INDEX avaliacao_turma_turma_idx ON avaliacao_turma (turma_id);

-- ============================================================
-- REALIZAÇÃO (RF08, RF09) — classe "Resultado" / termo "Tentativa" do glossário
-- ============================================================
CREATE TABLE tentativa (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  avaliacao_id       INTEGER NOT NULL REFERENCES avaliacao (id),
  estudante_id       INTEGER NOT NULL REFERENCES usuario (id),
  iniciada_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  prazo_final        TIMESTAMPTZ NOT NULL,                       -- DT06: calculado pelo servidor
  finalizada_em      TIMESTAMPTZ,
  status             TEXT NOT NULL DEFAULT 'EM_ANDAMENTO'
                     CHECK (status IN ('EM_ANDAMENTO', 'FINALIZADA', 'TEMPO_ESGOTADO', 'BLOQUEADA')),
  motivo_bloqueio    TEXT,                                       -- P-06: professor vê o motivo
  pontuacao_objetiva NUMERIC(8, 2),
  pontuacao_total    NUMERIC(8, 2),
  correcao_concluida BOOLEAN NOT NULL DEFAULT FALSE,             -- P-07: pré-requisito para liberar
  CONSTRAINT tentativa_unica_por_estudante UNIQUE (avaliacao_id, estudante_id),  -- P-04
  CHECK (status <> 'BLOQUEADA' OR motivo_bloqueio IS NOT NULL),
  CHECK (status = 'EM_ANDAMENTO' OR finalizada_em IS NOT NULL)
);
CREATE INDEX tentativa_estudante_idx ON tentativa (estudante_id);

-- "consolida" (Tentativa 1—N Resposta) e "referente a" (Questão 1—N Resposta).
CREATE TABLE resposta (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tentativa_id       INTEGER NOT NULL REFERENCES tentativa (id),
  questao_id         INTEGER NOT NULL REFERENCES questao (id),
  alternativa_id     INTEGER REFERENCES alternativa (id),        -- objetiva
  texto              TEXT,                                       -- discursiva
  atualizada_em      TIMESTAMPTZ NOT NULL DEFAULT now(),          -- "dataEnvio" (Fig. 7)
  correta            BOOLEAN,                                    -- objetiva, correção automática
  nota_sugerida_ia   NUMERIC(6, 2) CHECK (nota_sugerida_ia IS NULL OR nota_sugerida_ia >= 0),
  justificativa_ia   TEXT,                                       -- P-08: visível só ao professor
  ia_solicitada_em   TIMESTAMPTZ,
  nota_final         NUMERIC(6, 2) CHECK (nota_final IS NULL OR nota_final >= 0),  -- RN04
  feedback_professor TEXT,                                       -- P-08: "feedbacks" do RF13
  corrigida_por      INTEGER REFERENCES usuario (id),
  corrigida_em       TIMESTAMPTZ,
  CONSTRAINT resposta_unica_por_questao UNIQUE (tentativa_id, questao_id)  -- UPSERT do autosave
);
CREATE INDEX resposta_questao_idx ON resposta (questao_id);

-- ============================================================
-- MONITORAMENTO (RF10, RN03) — somente o sistema cria; ninguém altera (Quadro 31)
-- ============================================================
CREATE TABLE evento_monitoramento (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tentativa_id       INTEGER NOT NULL REFERENCES tentativa (id),
  tipo               TEXT NOT NULL
                     CHECK (tipo IN ('PERDA_FOCO', 'TROCA_ABA', 'ATALHO', 'RECURSO_INDISPONIVEL')),
  detalhe            TEXT,                                       -- ex.: "Ctrl+C"
  data_hora          TIMESTAMPTZ NOT NULL DEFAULT now(),          -- hora do servidor
  bloqueou_tentativa BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX evento_monitoramento_tentativa_idx ON evento_monitoramento (tentativa_id);
