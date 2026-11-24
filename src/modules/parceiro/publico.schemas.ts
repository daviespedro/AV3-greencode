import { EstadoFisico, SituacaoRelatorio, StatusEquipamento, StatusLote } from '@prisma/client';

export const uuid = { type: 'string', format: 'uuid' };
const dataHora = { type: 'string', format: 'date-time' };
const inteiro = { type: 'integer', minimum: 0 };
const texto = { type: 'string' };
const textoNulo = { type: 'string', nullable: true };
const numeroNulo = { type: 'number', nullable: true };
const objeto = <T extends Record<string, unknown>>(properties: T, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const lista = (items: object) => ({ type: 'array', items });
const paginada = (items: object) => objeto({
  itens: lista(items), total: inteiro, pagina: inteiro, tamanhoPagina: inteiro, totalPaginas: inteiro,
});
const dataEntrada = { type: 'string', format: 'date', examples: ['2026-11-24'], description: 'Data UTC da entrada, até 90 dias no passado. Padrão: hoje.' };
const nf = { type: 'string', maxLength: 80, pattern: '\\S', examples: ['NF-530'], description: 'Nota fiscal única por organização.' };
const transportadora = { type: 'string', maxLength: 160, pattern: '\\S', examples: ['TransVerde'], description: 'Nome da transportadora.' };
const tipo = { type: 'string', maxLength: 120, pattern: '\\S', examples: ['notebook'], description: 'Tipo do equipamento.' };
const equipamento = objeto({
  id: uuid, codigoBarrasInterno: uuid, loteId: uuid, tipo, posicao: inteiro,
  estadoFisico: { type: 'string', enum: Object.values(EstadoFisico) },
  status: { type: 'string', enum: Object.values(StatusEquipamento) },
});
const lote = objeto({
  id: uuid, nf, transportadora, dataEntrada: { ...dataHora, description: 'Data de entrada representada às 00:00 UTC.' },
  status: { type: 'string', enum: Object.values(StatusLote) },
});
const movimento = objeto({
  id: uuid, criadoEm: dataHora, statusDe: textoNulo, statusPara: textoNulo, estadoDe: textoNulo, estadoPara: textoNulo,
});
const relatorio = objeto({
  id: uuid, situacao: { type: 'string', enum: Object.values(SituacaoRelatorio), example: 'pendente' },
  tentativas: { ...inteiro, example: 0 }, criadoEm: dataHora, concluidoEm: { ...dataHora, nullable: true },
  agendamento: textoNulo, erro: textoNulo,
});
const dimensoes = { tipo, marca: texto, modelo: texto };
const tempo = { lotes: inteiro, mediaDias: numeroNulo };

export const publicos = {
  lote: { ...lote, example: {
    id: '0bd5437b-bd61-4d3e-9e65-40d5aec8df03', nf: 'NF-530', transportadora: 'TransVerde',
    dataEntrada: '2026-11-24T00:00:00.000Z', status: 'recebido',
  } },
  criarLote: {
    ...objeto({ nf, transportadora, dataEntrada, equipamentos: { ...lista(objeto({ tipo })), maxItems: 100 } }, ['nf', 'transportadora']),
    examples: [{ nf: 'NF-530', transportadora: 'TransVerde', equipamentos: [{ tipo: 'notebook' }] }],
  },
  loteCriado: objeto({ lote, equipamentos: lista(equipamento) }),
  rastreio: objeto({ equipamento, movimentacoes: paginada(movimento) }),
  relatorio,
  historico: paginada(relatorio),
  resultado: objeto({
    versaoModelo: texto, organizacaoId: uuid, geradoEm: dataHora,
    eficiencia: objeto({
      lotesAtivos: inteiro, semConclusaoUtilizavel: inteiro, entradaAConclusao: objeto(tempo), espera: objeto(tempo),
      triagem: objeto(tempo), etapaMaisLonga: textoNulo, porOperador: lista(objeto({ operadorId: uuid, ...tempo })),
      porMes: lista(objeto({ mes: texto, ...tempo })),
    }),
    rentabilidade: objeto({
      moeda: texto, equipamentosComValor: inteiro,
      grupos: lista(objeto({ ...dimensoes, estado: texto, amostras: inteiro, amostrasComCusto: inteiro,
        recuperacaoMedia: numeroNulo, margemMedia: numeroNulo })),
    }),
    vidaUtil: objeto({
      metodo: texto,
      grupos: lista(objeto({ ...dimensoes, amostras: inteiro, equipamentos: inteiro, motivo: textoNulo,
        r2: numeroNulo, idadeProjetadaDias: numeroNulo, vidaRemanescenteDias: numeroNulo })),
    }),
  }),
};

const erros: Record<number, [string, string]> = {
  400: ['ErroValidacao', 'Parâmetro ou corpo inválido.'],
  401: ['NaoAutenticado', 'Chave de API ausente, inválida ou expirada.'],
  403: ['ErroPermissao', 'A chave não possui o escopo necessário.'],
  404: ['NaoEncontrado', 'Recurso não encontrado para esta organização.'],
  409: ['Conflito', 'Operação incompatível com o estado atual do recurso.'],
  429: ['LimiteRequisicoes', 'Limite de requisições por minuto atingido.'],
  500: ['ErroInterno', 'Erro interno do servidor.'],
};

export const respostasPublicas = (status: number, resposta: object, ...extras: number[]) => ({
  [status]: resposta,
  ...Object.fromEntries([400, 401, 403, 429, 500, ...extras].map(codigo => {
    const [erro, mensagem] = erros[codigo];
    return [codigo, { ...objeto({ erro: texto, mensagem: texto }), description: mensagem, example: { erro, mensagem } }];
  })),
});

// Patrick Jane: Jane preparou exemplos para a entrevista. Cho preparou também os exemplos de quando a resposta era 429.
