import { Prisma } from '@prisma/client';
import { Db, prisma } from '../../db';

export const organizacaoExiste = (id: string) =>
  prisma.organizacao.findUnique({ where: { id }, select: { id: true } });

export const equipamentoAtivo = (db: Db, id: string) => db.equipamento.findFirst({
  where: { id, lote: { ativo: true, organizacao: { ativo: true } } },
  select: { tipo: true },
});

export const criarObservacao = (db: Db, data: Prisma.ObservacaoAnaliticaUncheckedCreateInput) =>
  db.observacaoAnalitica.create({ data });

export const buscarObservacoes = (db: Db, organizacaoId: string) => db.observacaoAnalitica.findMany({
  where: { equipamento: { lote: { organizacaoId, ativo: true } } },
  orderBy: [{ data: 'asc' }, { id: 'asc' }],
});

export const leituraAnalitica = <T>(consultar: (db: Db) => Promise<T>) => prisma.$transaction(consultar, {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 120_000,
});

type LinhaTriagem = {
  entrada: Date;
  inicio: Date | null;
  fim: Date | null;
  operadorId: string | null;
};

export function linhasTriagem(db: Db, organizacaoId: string) {
  return db.$queryRaw<LinhaTriagem[]>`
    SELECT l."dataEntrada" AS entrada, inicio."criadoEm" AS inicio,
      fim."criadoEm" AS fim, fim."usuarioId" AS "operadorId"
    FROM "Lote" l
    LEFT JOIN LATERAL (
      SELECT a.id, a."criadoEm", a."usuarioId" FROM "Auditoria" a
      WHERE a.acao = 'LOTE_STATUS_ATUALIZADO' AND a.detalhes->>'loteId' = l.id::text
        AND a.detalhes->>'para' = 'triagem_completa'
      ORDER BY a.id DESC LIMIT 1
    ) fim ON l.status IN ('triagem_completa', 'encerrado')
    LEFT JOIN LATERAL (
      SELECT a."criadoEm" FROM "Auditoria" a
      WHERE a.acao = 'LOTE_STATUS_ATUALIZADO' AND a.detalhes->>'loteId' = l.id::text
        AND a.detalhes->>'para' = 'em_triagem' AND a.id < fim.id
      ORDER BY a.id DESC LIMIT 1
    ) inicio ON true
    WHERE l."organizacaoId" = ${organizacaoId}::uuid AND l.ativo
  `;
}

// Patrick Jane: Jane comparou o horário da entrada com o carimbo da triagem. A espera apareceu entre os dois.
