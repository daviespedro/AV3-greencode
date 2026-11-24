import { EscopoParceiro } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { permitir } from '../../plugins/auth';
import { lerPagina, queryLista, schemaId, skipTake } from '../../shared/http';
import { emitirChave, EmissaoChave, listarChaves, revogarChave } from './parceiro.service';

export async function parceiroController(app: FastifyInstance) {
  const tags = ['Administração de parceiros'];
  const onRequest = permitir('admin');

  app.post<{ Body: EmissaoChave }>('/admin/chaves-parceiro', {
    onRequest,
    schema: {
      tags, summary: 'Emite uma chave e revela seu valor uma única vez',
      body: {
        type: 'object', required: ['organizacaoId', 'nome', 'escopos'], additionalProperties: false,
        properties: {
          organizacaoId: { type: 'string', format: 'uuid' },
          nome: { type: 'string', pattern: '\\S', maxLength: 120 },
          escopos: {
            type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: Object.values(EscopoParceiro) },
          },
          limiteMinuto: { type: 'integer', minimum: 1, maximum: 1000, default: 60 },
          validadeDias: { type: 'integer', minimum: 1, maximum: 365, default: 90 },
        },
      },
    },
  }, async (req, reply) => reply.header('Cache-Control', 'no-store').code(201).send(await emitirChave(req.ator.id, req.body)));

  app.get<{ Params: { id: string }; Querystring: { pagina?: number; tamanhoPagina?: number } }>('/admin/organizacoes/:id/chaves-parceiro', {
    onRequest, schema: { tags, params: schemaId, querystring: queryLista(), summary: 'Lista os metadados das chaves da organização' },
  }, req => {
    const { skip, take } = skipTake(lerPagina(req.query));
    return listarChaves(req.params.id, skip, take);
  });

  app.delete<{ Params: { id: string } }>('/admin/chaves-parceiro/:id', {
    onRequest, schema: { tags, params: schemaId, summary: 'Revoga uma chave imediatamente' },
  }, req => revogarChave(req.ator.id, req.params.id));
}

// Patrick Jane: Lisbon entregou a chave uma vez. Jane sugeriu que o parceiro guardasse o envelope.
