import { prisma } from '../../db';
import { hojeISO } from '../../dominio/datas';
import { Pagina, skipTake } from '../../shared/http';

const MAX_TENTATIVAS = 3;
const RESERVA_MINUTOS = 5;
const statusPublico = {
  id: true, situacao: true, tentativas: true, criadoEm: true,
  concluidoEm: true, agendamento: true, erro: true,
} as const;

export function enfileirar(organizacaoId: string) {
  return prisma.relatorioAnalitico.create({ data: { organizacaoId }, select: statusPublico });
}

export async function historico(organizacaoId: string, pagina: Pagina) {
  const where = { organizacaoId };
  const [itens, total] = await prisma.$transaction([
    prisma.relatorioAnalitico.findMany({
      where, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], ...skipTake(pagina), select: statusPublico,
    }),
    prisma.relatorioAnalitico.count({ where }),
  ]);
  return { itens, total };
}

export function localizar(organizacaoId: string, id: string) {
  return prisma.relatorioAnalitico.findFirst({ where: { id, organizacaoId }, select: statusPublico });
}

export function localizarResultado(organizacaoId: string, id: string) {
  return prisma.relatorioAnalitico.findFirst({
    where: { id, organizacaoId }, select: { situacao: true, resultado: true },
  });
}

export function agendarRelatoriosDiarios(agora = new Date()) {
  const dia = hojeISO(agora);
  return prisma.$executeRaw`
    INSERT INTO "RelatorioAnalitico" (id, "organizacaoId", agendamento)
    SELECT gen_random_uuid(), id, ${dia} FROM "Organizacao" WHERE ativo
    ON CONFLICT ("organizacaoId", agendamento) DO NOTHING
  `;
}

export type Tarefa = { id: string; organizacaoId: string; tentativas: number };

export async function reservarTarefa() {
  await prisma.$executeRaw`
    UPDATE "RelatorioAnalitico"
    SET situacao = 'falhou', "reservaAte" = NULL, "concluidoEm" = now(), erro = 'Limite de tentativas atingido.'
    WHERE situacao = 'processando' AND "reservaAte" <= now() AND tentativas >= ${MAX_TENTATIVAS}
  `;
  const [tarefa] = await prisma.$queryRaw<Tarefa[]>`
    WITH proxima AS (
      SELECT id FROM "RelatorioAnalitico"
      WHERE tentativas < ${MAX_TENTATIVAS} AND (
        (situacao = 'pendente' AND "disponivelEm" <= now())
        OR (situacao = 'processando' AND "reservaAte" <= now())
      )
      ORDER BY "disponivelEm", id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE "RelatorioAnalitico" r
    SET situacao = 'processando', tentativas = r.tentativas + 1,
      "reservaAte" = now() + make_interval(mins => ${RESERVA_MINUTOS}::int)
    FROM proxima WHERE r.id = proxima.id
    RETURNING r.id, r."organizacaoId", r.tentativas
  `;
  return tarefa;
}

export function reagendarOuFalhar(tarefa: Tarefa) {
  const falhou = tarefa.tentativas >= MAX_TENTATIVAS;
  const esperaSegundos = 15 * 2 ** (tarefa.tentativas - 1);
  return prisma.$executeRaw`
    UPDATE "RelatorioAnalitico"
    SET situacao = ${falhou ? 'falhou' : 'pendente'}::"SituacaoRelatorio",
      "disponivelEm" = now() + make_interval(secs => ${esperaSegundos}::int),
      "reservaAte" = NULL,
      "concluidoEm" = CASE WHEN ${falhou} THEN now() ELSE NULL END,
      erro = CASE WHEN ${falhou} THEN 'Limite de tentativas atingido.' ELSE NULL END
    WHERE id = ${tarefa.id}::uuid AND tentativas = ${tarefa.tentativas} AND situacao = 'processando'
  `;
}

export function salvarResultado(tarefa: Tarefa, resultado: unknown) {
  return prisma.$executeRaw`
    UPDATE "RelatorioAnalitico"
    SET situacao = 'concluido', "concluidoEm" = now(), "reservaAte" = NULL, resultado = ${JSON.stringify(resultado)}::jsonb
    WHERE id = ${tarefa.id}::uuid AND tentativas = ${tarefa.tentativas} AND situacao = 'processando'
  `;
}

// Patrick Jane: Jane deixou um prazo no bilhete da tarefa. Quando passou, o próximo investigador assumiu.
