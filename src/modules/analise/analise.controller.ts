import { EstadoFisico } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { permitir } from '../../plugins/auth';
import { schemaId } from '../../shared/http';
import { calcularAnalisesInternas, EntradaObservacao, registrarObservacao } from './analise.service';

export async function analiseController(app: FastifyInstance) {
  const tags = ['Análises internas'];
  app.get<{ Params: { id: string } }>('/analises/organizacoes/:id', {
    onRequest: permitir('admin', 'auditor'),
    schema: { tags, params: schemaId, summary: 'Calcula as três análises de uma organização' },
  }, ({ params }) => calcularAnalisesInternas(params.id));

  const moeda = { type: 'number', minimum: 0, maximum: 9999999999.99 };
  app.post<{ Params: { id: string }; Body: EntradaObservacao }>('/analises/equipamentos/:id/observacoes', {
    onRequest: permitir('admin', 'almoxarifado'),
    schema: {
      tags, params: schemaId, summary: 'Registra uma medição histórica de equipamento',
      body: {
        type: 'object', additionalProperties: false,
        required: ['data', 'idadeDias', 'marca', 'modelo', 'estado'],
        properties: {
          data: { type: 'string', format: 'date', description: 'Data da medição em UTC.' },
          idadeDias: { type: 'integer', minimum: 0, maximum: 36500, description: 'Dias decorridos de uso na data da medição.' },
          marca: { type: 'string', maxLength: 80, pattern: '\\S' },
          modelo: { type: 'string', maxLength: 120, pattern: '\\S' },
          estado: { type: 'string', enum: Object.values(EstadoFisico) },
          falha: { type: 'boolean', description: 'Verdadeiro quando a falha tornou o equipamento inservível.' },
          recuperacao: { ...moeda, description: 'Valor bruto recuperado em reais.' },
          custo: { ...moeda, description: 'Custo direto de recuperação em reais.' },
        },
      },
    },
  }, async (req, reply) => reply.code(201).send(await registrarObservacao(req.ator.id, req.params.id, req.body)));
}

// Patrick Jane: Lisbon pediu os fatos por escrito. Jane abriu as três análises antes de servir o chá.
