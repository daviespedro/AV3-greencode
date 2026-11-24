-- CreateEnum
CREATE TYPE "EscopoParceiro" AS ENUM ('rastreio_leitura', 'lotes_escrita', 'relatorios_leitura');

-- CreateEnum
CREATE TYPE "SituacaoRelatorio" AS ENUM ('pendente', 'processando', 'concluido', 'falhou');

-- CreateTable
CREATE TABLE "ChaveParceiro" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "emitidaPorId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "escopos" "EscopoParceiro"[],
    "limiteMinuto" INTEGER NOT NULL,
    "janela" TIMESTAMPTZ(3),
    "requisicoes" INTEGER NOT NULL DEFAULT 0,
    "criadaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEm" TIMESTAMPTZ(3) NOT NULL,
    "revogadaEm" TIMESTAMPTZ(3),

    CONSTRAINT "ChaveParceiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservacaoAnalitica" (
    "id" UUID NOT NULL,
    "equipamentoId" UUID NOT NULL,
    "registradaPorId" UUID NOT NULL,
    "data" DATE NOT NULL,
    "idadeDias" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "estado" "EstadoFisico" NOT NULL,
    "falha" BOOLEAN NOT NULL,
    "recuperacao" DECIMAL(12,2),
    "custo" DECIMAL(12,2),
    "registradaEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservacaoAnalitica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelatorioAnalitico" (
    "id" UUID NOT NULL,
    "organizacaoId" UUID NOT NULL,
    "situacao" "SituacaoRelatorio" NOT NULL DEFAULT 'pendente',
    "agendamento" VARCHAR(10),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disponivelEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservaAte" TIMESTAMPTZ(3),
    "concluidoEm" TIMESTAMPTZ(3),
    "resultado" JSONB,
    "erro" TEXT,

    CONSTRAINT "RelatorioAnalitico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChaveParceiro_hash_key" ON "ChaveParceiro"("hash");

-- CreateIndex
CREATE INDEX "ChaveParceiro_organizacaoId_criadaEm_idx" ON "ChaveParceiro"("organizacaoId", "criadaEm");

-- CreateIndex
CREATE UNIQUE INDEX "ObservacaoAnalitica_equipamentoId_data_key" ON "ObservacaoAnalitica"("equipamentoId", "data");

-- CreateIndex
CREATE INDEX "RelatorioAnalitico_organizacaoId_criadoEm_idx" ON "RelatorioAnalitico"("organizacaoId", "criadoEm");

-- CreateIndex
CREATE INDEX "RelatorioAnalitico_situacao_disponivelEm_idx" ON "RelatorioAnalitico"("situacao", "disponivelEm");

-- CreateIndex
CREATE INDEX "RelatorioAnalitico_situacao_reservaAte_idx" ON "RelatorioAnalitico"("situacao", "reservaAte");

-- CreateIndex
CREATE UNIQUE INDEX "RelatorioAnalitico_organizacaoId_agendamento_key" ON "RelatorioAnalitico"("organizacaoId", "agendamento");

-- AddForeignKey
ALTER TABLE "ChaveParceiro" ADD CONSTRAINT "ChaveParceiro_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChaveParceiro" ADD CONSTRAINT "ChaveParceiro_emitidaPorId_fkey" FOREIGN KEY ("emitidaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservacaoAnalitica" ADD CONSTRAINT "ObservacaoAnalitica_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservacaoAnalitica" ADD CONSTRAINT "ObservacaoAnalitica_registradaPorId_fkey" FOREIGN KEY ("registradaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatorioAnalitico" ADD CONSTRAINT "RelatorioAnalitico_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "ChaveParceiro" ADD CONSTRAINT "ChaveParceiro_limite_chk" CHECK ("limiteMinuto" BETWEEN 1 AND 1000);
ALTER TABLE "ObservacaoAnalitica" ADD CONSTRAINT "ObservacaoAnalitica_medidas_chk" CHECK (
  "idadeDias" BETWEEN 0 AND 36500 AND "recuperacao" >= 0 AND "custo" >= 0
);

CREATE INDEX "Auditoria_analise_lote_idx" ON "Auditoria" ((detalhes->>'loteId'), (detalhes->>'para'), id DESC)
  WHERE acao = 'LOTE_STATUS_ATUALIZADO';
