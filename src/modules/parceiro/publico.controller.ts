import { EscopoParceiro } from '@prisma/client';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ErroApp, erroPermissao } from '../../errors';
import { lerPagina, paginar, queryLista, schemaId } from '../../shared/http';
import { baixar, consultar, enfileirar, historico } from '../analise/relatorio.service';
import { loteService } from '../lote/lote.service';
import { Acesso, autenticarParceiro, obterLote, obterRastreio } from './parceiro.service';
import { publicos, respostasPublicas } from './publico.schemas';

declare module 'fastify' {
  interface FastifyRequest {
    acessoParceiro: Acesso;
  }
}

type Id = { Params: { id: string } };
type Paginada = { Querystring: { pagina?: number; tamanhoPagina?: number } };
type EntradaLote = { Body: { nf: string; transportadora: string; dataEntrada?: string; equipamentos?: { tipo: string }[] } };

const tags = ['API pública v1'];
const paginacaoPublica = queryLista({
  pagina: { type: 'integer', minimum: 1, maximum: 1_000_000, default: 1, description: 'Página inicial igual a 1.' },
  tamanhoPagina: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Quantidade de itens por página.' },
});
const config = { publica: true };
const PREFIXO = '/api/v1/public';
const caminhoRelatorio = (id: string) => `${PREFIXO}/relatorios/${id}`;

async function exigirAcesso(chave: unknown, escopo: EscopoParceiro, reply: FastifyReply) {
  const acesso = await autenticarParceiro(chave);
  const segundos = Math.max(1, Math.ceil((acesso.reiniciaEm.getTime() - Date.now()) / 1000));
  reply.header('Cache-Control', 'no-store');
  reply.header('X-RateLimit-Limit', acesso.limiteMinuto);
  reply.header('X-RateLimit-Remaining', Math.max(0, acesso.limiteMinuto - acesso.requisicoes));
  reply.header('X-RateLimit-Reset', Math.floor(acesso.reiniciaEm.getTime() / 1000));
  if (acesso.requisicoes > acesso.limiteMinuto) {
    reply.header('Retry-After', segundos);
    throw new ErroApp(429, 'LimiteRequisicoes', 'Limite de requisições por minuto atingido.');
  }
  if (!acesso.escopos.includes(escopo)) throw erroPermissao(`Escopo necessário: ${escopo}.`);
  return acesso;
}

export async function publicoController(app: FastifyInstance) {
  app.decorateRequest('acessoParceiro', null as unknown as Acesso);
  const acesso = (escopo: EscopoParceiro) => ({
    config,
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      req.acessoParceiro = await exigirAcesso(req.headers['x-api-key'], escopo, reply);
    },
  });
  const esquema = (escopo: EscopoParceiro, summary: string, response: object) => ({
    tags, summary, security: [{ parceiroApiKey: [] }], response,
    description: `Escopo exigido: ${escopo}. Limite por chave em janela de um minuto. Em 429, use Retry-After.`,
  });

  app.post<EntradaLote>('/lotes', {
    ...acesso('lotes_escrita'),
    schema: {
      ...esquema('lotes_escrita', 'Cadastra um lote na organização da chave', respostasPublicas(201, publicos.loteCriado, 404, 409)),
      body: publicos.criarLote,
    },
  }, async (req, reply) => {
    const { cnpj, emitidaPorId, organizacaoId, id: chaveId } = req.acessoParceiro;
    const criado = await loteService.criar(
      { id: emitidaPorId, username: 'parceiro', papel: 'admin' },
      { ...req.body, orgCnpj: cnpj },
      { organizacaoId, chaveId },
    );
    return reply.header('Location', `${PREFIXO}/lotes/${criado.lote.id}`).code(201).send(criado);
  });

  app.get<Id>('/lotes/:id', {
    ...acesso('rastreio_leitura'),
    schema: {
      ...esquema('rastreio_leitura', 'Consulta os dados e o status de um lote ativo', respostasPublicas(200, publicos.lote, 404)),
      params: schemaId,
    },
  }, req => obterLote(req.acessoParceiro.organizacaoId, req.params.id));

  app.get<Id & Paginada>('/equipamentos/:id/rastreio', {
    ...acesso('rastreio_leitura'),
    schema: {
      ...esquema('rastreio_leitura', 'Consulta o equipamento e seu histórico de movimentações', respostasPublicas(200, publicos.rastreio, 404)),
      params: schemaId, querystring: paginacaoPublica,
    },
  }, req => obterRastreio(req.acessoParceiro.organizacaoId, req.params.id, lerPagina(req.query)));

  const leitura = acesso('relatorios_leitura');
  app.post('/relatorios', {
    ...leitura, schema: esquema('relatorios_leitura', 'Enfileira um relatório analítico completo', respostasPublicas(202, publicos.relatorio)),
  }, async (req, reply) => {
    const relatorio = await enfileirar(req.acessoParceiro.organizacaoId);
    return reply.header('Location', caminhoRelatorio(relatorio.id)).code(202).send(relatorio);
  });

  app.get<Paginada>('/relatorios', {
    ...leitura,
    schema: {
      ...esquema('relatorios_leitura', 'Lista tarefas e relatórios históricos da organização', respostasPublicas(200, publicos.historico)),
      querystring: paginacaoPublica,
    },
  }, async req => {
    const pagina = lerPagina(req.query);
    return paginar(await historico(req.acessoParceiro.organizacaoId, pagina), pagina);
  });

  app.get<Id>('/relatorios/:id', {
    ...leitura, schema: {
      ...esquema('relatorios_leitura', 'Consulta a situação de uma tarefa', respostasPublicas(200, publicos.relatorio, 404)),
      params: schemaId,
    },
  }, req => consultar(req.acessoParceiro.organizacaoId, req.params.id));

  app.get<Id>('/relatorios/:id/download', {
    ...leitura, schema: {
      ...esquema('relatorios_leitura', 'Baixa o resultado concluído em JSON', respostasPublicas(200, publicos.resultado, 404, 409)),
      params: schemaId,
    },
  }, async (req, reply) => {
    const resultado = await baixar(req.acessoParceiro.organizacaoId, req.params.id);
    return reply.header('Content-Disposition', `attachment; filename="greencode-${req.params.id}.json"`).send(resultado);
  });
}

// Patrick Jane: Jane abriu a porta dos visitantes. A chave dizia a qual sala o parceiro podia ir.
