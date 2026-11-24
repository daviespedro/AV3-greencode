import { EscopoParceiro, Prisma } from '@prisma/client';
import { Db, prisma } from '../../db';
import { Pagina, paginar, skipTake } from '../../shared/http';

const metadados = {
  id: true, organizacaoId: true, nome: true, escopos: true,
  limiteMinuto: true, criadaEm: true, expiraEm: true, revogadaEm: true,
} as const;

export const organizacaoAtiva = (db: Db, id: string) =>
  db.organizacao.findFirst({ where: { id, ativo: true }, select: { id: true } });

export const criarChave = (db: Db, data: Prisma.ChaveParceiroUncheckedCreateInput) =>
  db.chaveParceiro.create({ data, select: metadados });

export const obterChave = (db: Db, id: string) => db.chaveParceiro.findUniqueOrThrow({ where: { id }, select: metadados });

export const marcarRevogada = (db: Db, id: string) => db.chaveParceiro.updateMany({
  where: { id, revogadaEm: null }, data: { revogadaEm: new Date() },
});

export function listarChaves(organizacaoId: string, skip: number, take: number) {
  return prisma.chaveParceiro.findMany({
    where: { organizacaoId }, select: metadados, orderBy: [{ criadaEm: 'desc' }, { id: 'desc' }], skip, take,
  });
}

export interface Acesso {
  id: string;
  organizacaoId: string;
  emitidaPorId: string;
  cnpj: string;
  escopos: EscopoParceiro[];
  limiteMinuto: number;
  requisicoes: number;
  reiniciaEm: Date;
}

export async function consumirLimite(hash: string) {
  const [acesso] = await prisma.$queryRaw<Acesso[]>`
    UPDATE "ChaveParceiro" c
    SET janela = greatest(janela, date_trunc('minute', now())),
      requisicoes = CASE WHEN janela >= date_trunc('minute', now())
        THEN least(c.requisicoes + 1, c."limiteMinuto" + 1) ELSE 1 END
    FROM "Organizacao" o, "Usuario" u
    WHERE c.hash = ${hash} AND c."revogadaEm" IS NULL AND c."expiraEm" > now()
      AND o.id = c."organizacaoId" AND o.ativo AND u.id = c."emitidaPorId" AND u.ativo AND u.papel = 'admin'
    RETURNING c.id, c."organizacaoId", c."emitidaPorId", o.cnpj, c.escopos, c."limiteMinuto",
      c.requisicoes, c.janela + interval '1 minute' AS "reiniciaEm"
  `;
  return acesso;
}

export function localizarLote(organizacaoId: string, id: string) {
  return prisma.lote.findFirst({
    where: { id, organizacaoId, ativo: true },
    select: { id: true, nf: true, transportadora: true, dataEntrada: true, status: true },
  });
}

export function localizarRastreio(organizacaoId: string, id: string, pagina: Pagina) {
  return prisma.$transaction(async db => {
    const equipamento = await db.equipamento.findFirst({
      where: { id, lote: { organizacaoId, ativo: true } },
      select: { id: true, loteId: true, codigoBarrasInterno: true, tipo: true, posicao: true, estadoFisico: true, status: true },
    });
    if (!equipamento) return null;
    const where = { equipamentoId: equipamento.id };
    const itens = await db.movimentacao.findMany({
      where, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], ...skipTake(pagina),
      select: { id: true, criadoEm: true, statusDe: true, statusPara: true, estadoDe: true, estadoPara: true },
    });
    return { equipamento, movimentacoes: paginar({ itens, total: await db.movimentacao.count({ where }) }, pagina) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

// Patrick Jane: Van Pelt contou as visitas da chave dentro do mesmo minuto. Jane olhou o relógio da parede.
