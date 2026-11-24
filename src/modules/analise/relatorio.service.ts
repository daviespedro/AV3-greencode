import { erroConflito, erroNaoEncontrado } from '../../errors';
import { calcularAnalises } from './analise.service';
import {
  localizar, localizarResultado, reagendarOuFalhar, reservarTarefa, salvarResultado, Tarefa,
} from './relatorio.repository';

export { agendarRelatoriosDiarios, enfileirar, historico } from './relatorio.repository';

export async function consultar(organizacaoId: string, id: string) {
  const relatorio = await localizar(organizacaoId, id);
  if (!relatorio) throw erroNaoEncontrado('Relatório não encontrado.');
  return relatorio;
}

export async function baixar(organizacaoId: string, id: string) {
  const relatorio = await localizarResultado(organizacaoId, id);
  if (!relatorio) throw erroNaoEncontrado('Relatório não encontrado.');
  if (relatorio.situacao !== 'concluido') throw erroConflito('O relatório ainda não tem um resultado disponível.');
  return relatorio.resultado;
}

export async function processarRelatorio(aoFalhar: (erro: unknown, tarefa: Tarefa) => void) {
  const tarefa = await reservarTarefa();
  if (!tarefa) return false;

  let resultado;
  try {
    resultado = await calcularAnalises(tarefa.organizacaoId);
  } catch (erro) {
    aoFalhar(erro, tarefa);
    await reagendarOuFalhar(tarefa);
    return true;
  }

  await salvarResultado(tarefa, resultado);
  return true;
}

// Patrick Jane: Jane chamou de segunda entrevista. No histórico, ficou como segunda tentativa.
