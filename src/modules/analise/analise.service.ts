import { EstadoFisico, Prisma } from '@prisma/client';
import { Db, transacao } from '../../db';
import { hojeISO, lerDataISO } from '../../dominio/datas';
import { erroNaoEncontrado, erroValidacao } from '../../errors';
import { auditoriaRepo } from '../auditoria/auditoria.repository';
import {
  buscarObservacoes, criarObservacao, equipamentoAtivo, leituraAnalitica, linhasTriagem, organizacaoExiste,
} from './analise.repository';

const DIA_MS = 86_400_000;
const arredondar = (n: number) => Math.round(n * 100) / 100;
const media = (ns: number[]) => ns.length ? ns.reduce((total, n) => total + n, 0) / ns.length : null;
const mediaArredondada = (ns: number[]) => {
  const valor = media(ns);
  return valor === null ? null : arredondar(valor);
};

async function eficiencia(db: Db, organizacaoId: string) {
  const linhas = await linhasTriagem(db, organizacaoId);
  const total: number[] = [];
  const espera: number[] = [];
  const triagem: number[] = [];
  const operadores = new Map<string, number[]>();
  const meses = new Map<string, number[]>();
  const agrupar = (grupos: Map<string, number[]>, chave: string, valor: number) => {
    const valores = grupos.get(chave) ?? [];
    valores.push(valor);
    grupos.set(chave, valores);
  };

  for (const { entrada, inicio, fim, operadorId } of linhas) {
    if (!fim || fim < entrada) continue;
    const dias = (fim.getTime() - entrada.getTime()) / DIA_MS;
    total.push(dias);
    if (operadorId) agrupar(operadores, operadorId, dias);
    agrupar(meses, fim.toISOString().slice(0, 7), dias);
    if (inicio && inicio >= entrada && inicio <= fim) {
      espera.push((inicio.getTime() - entrada.getTime()) / DIA_MS);
      triagem.push((fim.getTime() - inicio.getTime()) / DIA_MS);
    }
  }

  const resumir = (valores: number[]) => ({ lotes: valores.length, mediaDias: mediaArredondada(valores) });
  const porOperador = [...operadores].sort(([a], [b]) => a.localeCompare(b))
    .map(([operadorId, valores]) => ({ operadorId, ...resumir(valores) }));
  const porMes = [...meses].sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, valores]) => ({ mes, ...resumir(valores) }));
  const esperaMedia = media(espera);
  const triagemMedia = media(triagem);
  const etapaMaisLonga = esperaMedia === null || triagemMedia === null ? null
    : esperaMedia === triagemMedia ? 'empate' : esperaMedia > triagemMedia ? 'espera' : 'triagem';
  return {
    lotesAtivos: linhas.length,
    semConclusaoUtilizavel: linhas.length - total.length,
    entradaAConclusao: resumir(total),
    espera: resumir(espera),
    triagem: resumir(triagem),
    etapaMaisLonga,
    porOperador,
    porMes,
  };
}

type Observacao = Awaited<ReturnType<typeof buscarObservacoes>>[number];

function agruparObservacoes(observacoes: Observacao[], dimensoes: (o: Observacao) => string[]) {
  const grupos = new Map<string, Observacao[]>();
  for (const obs of observacoes) {
    const chave = JSON.stringify(dimensoes(obs));
    const grupo = grupos.get(chave) ?? [];
    grupo.push(obs);
    grupos.set(chave, grupo);
  }
  return [...grupos].sort(([a], [b]) => a.localeCompare(b)).map(([, grupo]) => grupo);
}

function rentabilidade(observacoes: Observacao[]) {
  const porEquipamento = new Map<string, Observacao>();
  for (const obs of observacoes) {
    if (obs.recuperacao !== null) porEquipamento.set(obs.equipamentoId, obs);
  }
  const grupos = agruparObservacoes([...porEquipamento.values()], o => [o.tipo, o.marca, o.modelo, o.estado]);
  return {
    moeda: 'BRL',
    equipamentosComValor: porEquipamento.size,
    grupos: grupos.map(grupo => {
      const { tipo, marca, modelo, estado } = grupo[0];
      const recuperacao = grupo.map(o => Number(o.recuperacao));
      const margens = grupo.filter(o => o.custo !== null).map(o => Number(o.recuperacao!.minus(o.custo!)));
      return {
        tipo, marca, modelo, estado,
        amostras: recuperacao.length,
        amostrasComCusto: margens.length,
        recuperacaoMedia: mediaArredondada(recuperacao),
        margemMedia: mediaArredondada(margens),
      };
    }).sort((a, b) => b.recuperacaoMedia! - a.recuperacaoMedia!),
  };
}

const DEGRADACAO: Record<EstadoFisico, number> = {
  novo: 0, seminovo: 1, bom: 2, regular: 3, ruim: 4, sucata: 5,
};

function projetar(grupo: Observacao[]) {
  const ultimas = new Map(grupo.map(o => [o.equipamentoId, o]));
  const pontos = grupo.map(o => ({ x: o.idadeDias, y: o.falha ? 5 : DEGRADACAO[o.estado] }));
  const { tipo, marca, modelo } = grupo[0];
  const idadeMediaAtiva = media([...ultimas.values()]
    .filter(o => !o.falha && o.estado !== 'sucata').map(o => o.idadeDias));
  const base = { tipo, marca, modelo, amostras: pontos.length, equipamentos: ultimas.size };
  const semEstimativa = (motivo: string, r2: number | null = null) =>
    ({ ...base, motivo, r2, idadeProjetadaDias: null, vidaRemanescenteDias: null });
  if (pontos.length < 3 || ultimas.size < 2) return semEstimativa('amostra_insuficiente');

  const xMedia = media(pontos.map(p => p.x))!;
  const yMedia = media(pontos.map(p => p.y))!;
  const sxx = pontos.reduce((s, p) => s + (p.x - xMedia) ** 2, 0);
  const syy = pontos.reduce((s, p) => s + (p.y - yMedia) ** 2, 0);
  if (sxx === 0 || syy === 0) return semEstimativa('sem_variacao');
  const sxy = pontos.reduce((s, p) => s + (p.x - xMedia) * (p.y - yMedia), 0);
  const inclinacao = sxy / sxx;
  const r2 = Math.min(1, sxy ** 2 / (sxx * syy));
  if (inclinacao <= 0 || r2 < 0.2) return semEstimativa('ajuste_fraco', arredondar(r2));
  const idadeProjetada = xMedia + (5 - yMedia) / inclinacao;
  if (idadeProjetada < 0 || idadeProjetada > 36500) return semEstimativa('fora_do_horizonte', arredondar(r2));
  return {
    ...base,
    motivo: null,
    r2: arredondar(r2),
    idadeProjetadaDias: Math.round(idadeProjetada),
    vidaRemanescenteDias: idadeMediaAtiva === null ? null : Math.round(Math.max(0, idadeProjetada - idadeMediaAtiva)),
  };
}

export async function calcularAnalises(organizacaoId: string) {
  return leituraAnalitica(async db => {
    const observacoes = await buscarObservacoes(db, organizacaoId);
    return {
      versaoModelo: '1.0.0',
      organizacaoId,
      geradoEm: new Date().toISOString(),
      eficiencia: await eficiencia(db, organizacaoId),
      rentabilidade: rentabilidade(observacoes),
      vidaUtil: {
        metodo: 'minimos_quadrados_ordinarios',
        grupos: agruparObservacoes(observacoes, o => [o.tipo, o.marca, o.modelo]).map(projetar),
      },
    };
  });
}

export async function calcularAnalisesInternas(organizacaoId: string) {
  if (!await organizacaoExiste(organizacaoId)) throw erroNaoEncontrado('Organização não encontrada.');
  return calcularAnalises(organizacaoId);
}

export interface EntradaObservacao {
  data: string;
  idadeDias: number;
  marca: string;
  modelo: string;
  estado: EstadoFisico;
  falha?: boolean;
  recuperacao?: number;
  custo?: number;
}

export function registrarObservacao(usuarioId: string, equipamentoId: string, entrada: EntradaObservacao) {
  const data = lerDataISO(entrada.data, 'Data da observação');
  if (entrada.data > hojeISO()) throw erroValidacao('A data da observação não pode ser futura.');
  for (const valor of [entrada.recuperacao, entrada.custo]) {
    if (valor !== undefined && new Prisma.Decimal(valor).decimalPlaces() > 2) {
      throw erroValidacao('Valores monetários devem ter no máximo duas casas decimais.');
    }
  }

  return transacao(async db => {
    const equipamento = await equipamentoAtivo(db, equipamentoId);
    if (!equipamento) throw erroNaoEncontrado('Equipamento ativo não encontrado.');
    const observacao = await criarObservacao(db, {
      ...entrada, data, equipamentoId, registradaPorId: usuarioId, tipo: equipamento.tipo,
      marca: entrada.marca.trim().toLowerCase(), modelo: entrada.modelo.trim().toLowerCase(),
      falha: entrada.falha ?? false,
    });
    await auditoriaRepo.registrar(db, usuarioId, 'OBSERVACAO_ANALITICA_REGISTRADA', { equipamentoId, observacaoId: observacao.id });
    return observacao;
  });
}

// Patrick Jane: Jane desenhou uma reta no quadro. Cho pediu para ver quantos pontos sustentavam a previsão.
