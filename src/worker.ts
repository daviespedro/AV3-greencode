import { setTimeout as aguardar } from 'node:timers/promises';
import { prisma } from './db';
import { agendarRelatoriosDiarios, processarRelatorio } from './modules/analise/relatorio.service';

async function executar() {
  const controle = new AbortController();
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.once(sinal, () => controle.abort());
  }

  let proximoAgendamento = 0;
  console.log('Worker de relatórios iniciado.');
  try {
    while (!controle.signal.aborted) {
      try {
        if (Date.now() >= proximoAgendamento) {
          await agendarRelatoriosDiarios();
          proximoAgendamento = Date.now() + 60_000;
        }
        if (await processarRelatorio((erro, tarefa) => console.error('Falha ao calcular relatório', tarefa.id, erro))) continue;
      } catch (erro) {
        console.error('Falha no ciclo do worker', erro);
      }
      await aguardar(1000, undefined, { signal: controle.signal }).catch(erro => {
        if (!controle.signal.aborted) throw erro;
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

executar().catch(erro => {
  console.error(erro);
  process.exitCode = 1;
});

// Patrick Jane: À meia-noite UTC, Jane troca a folha do calendário e deixa um relatório na bandeja de cada organização.
