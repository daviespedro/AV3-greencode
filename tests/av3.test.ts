import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Ambiente, criarAmbiente, dia, Tokens } from './helpers/ambiente';

let ambiente: Ambiente;
let tokens: Tokens;
let org: { id: string; cnpj: string };
let outra: { id: string; cnpj: string };
const PUBLICA = '/api/v1/public';

before(async () => {
  ambiente = await criarAmbiente();
  tokens = await ambiente.usuariosBase();
  const cnpj = await ambiente.orgComContrato(tokens.admin, '471523630001');
  const outroCnpj = await ambiente.orgComContrato(tokens.admin, '471523630002');
  org = await ambiente.prisma.organizacao.findUniqueOrThrow({ where: { cnpj } });
  outra = await ambiente.prisma.organizacao.findUniqueOrThrow({ where: { cnpj: outroCnpj } });
});
after(async () => ambiente?.encerrar());

async function chave(organizacaoId: string, escopos: string[], limiteMinuto = 60) {
  const resp = await ambiente.api('POST', '/admin/chaves-parceiro', tokens.admin, {
    organizacaoId, nome: 'Parceiro de teste', escopos, limiteMinuto,
  });
  assert.equal(resp.statusCode, 201, resp.body);
  return resp.json();
}

function publica(method: 'GET' | 'POST', caminho: string, segredo?: string, payload?: Record<string, unknown>) {
  return ambiente.app.inject({
    method, url: PUBLICA + caminho, headers: segredo ? { 'x-api-key': segredo } : {}, payload,
  });
}

test('API pública documenta a separação entre JWT e chave de parceiro', async () => {
  const contrato = await ambiente.app.inject('/openapi-public.json');
  assert.equal(contrato.statusCode, 200, contrato.body);
  const doc = contrato.json();
  assert.equal(Object.keys(doc.paths).length, 6);
  assert.ok(Object.keys(doc.paths).every(caminho => caminho.startsWith(PUBLICA + '/')));
  assert.deepEqual(doc.paths[PUBLICA + '/lotes'].post.security, [{ parceiroApiKey: [] }]);
  assert.ok(doc.paths[PUBLICA + '/lotes'].post.responses['429']);
  assert.equal(doc.components.securitySchemes.parceiroApiKey.name, 'x-api-key');
  assert.equal((await ambiente.app.inject('/docs/')).statusCode, 200);
});

test('emite, limita, restringe por organização e revoga chaves', async () => {
  const semChave = await publica('GET', '/relatorios');
  assert.equal(semChave.statusCode, 401);
  assert.equal((await ambiente.api('GET', '/public/relatorios', tokens.admin)).statusCode, 401);

  const r = await chave(org.id, ['rastreio_leitura']);
  const escrita = await chave(org.id, ['lotes_escrita']);
  const segredo = escrita.chave;
  assert.match(segredo, /^gc_/);
  const gravada = await ambiente.prisma.chaveParceiro.findUniqueOrThrow({ where: { id: escrita.id } });
  assert.notEqual(gravada.hash, segredo);
  const listagem = await ambiente.api('GET', `/admin/organizacoes/${org.id}/chaves-parceiro`, tokens.admin);
  assert.ok(!listagem.body.includes(gravada.hash) && !listagem.body.includes(segredo));
  assert.equal((await ambiente.api('POST', '/admin/chaves-parceiro', tokens.alm, {})).statusCode, 403);

  const entrada = { nf: 'AV3-PARCEIRO', transportadora: 'TransVerde', equipamentos: [{ tipo: 'CPU' }] };
  assert.equal((await publica('POST', '/lotes', r.chave, entrada)).statusCode, 403);
  assert.equal((await publica('POST', '/lotes', segredo, { ...entrada, orgCnpj: outra.cnpj })).statusCode, 400);
  const criado = await publica('POST', '/lotes', segredo, entrada);
  assert.equal(criado.statusCode, 201, criado.body);
  const { lote, equipamentos } = criado.json();
  assert.equal(criado.headers.location, `${PUBLICA}/lotes/${lote.id}`);
  assert.equal(lote.organizacaoId, undefined);
  assert.equal((await ambiente.prisma.lote.findUniqueOrThrow({ where: { id: lote.id } })).organizacaoId, org.id);
  const auditoria = await ambiente.prisma.auditoria.findFirstOrThrow({
    where: { acao: 'LOTE_CRIADO', detalhes: { path: ['loteId'], equals: lote.id } },
  });
  assert.equal((auditoria.detalhes as { chaveId: string }).chaveId, escrita.id);
  assert.equal((await publica('POST', '/lotes', segredo, entrada)).statusCode, 409);
  assert.equal((await publica('GET', `/lotes/${lote.id}`, r.chave)).statusCode, 200);
  const caminhoRastreio = `/equipamentos/${equipamentos[0].id}/rastreio`;
  const rastreio = await publica('GET', caminhoRastreio, r.chave);
  assert.equal(rastreio.statusCode, 200, rastreio.body);
  assert.equal(rastreio.json().equipamento.id, equipamentos[0].id);

  const vizinha = await chave(outra.id, ['rastreio_leitura']);
  assert.equal((await publica('GET', `/lotes/${lote.id}`, vizinha.chave)).statusCode, 404);
  assert.equal((await publica('GET', caminhoRastreio, vizinha.chave)).statusCode, 404);

  const limitada = await chave(org.id, ['rastreio_leitura'], 1);
  const [primeira, segunda] = await Promise.all([
    publica('GET', caminhoRastreio, limitada.chave), publica('GET', caminhoRastreio, limitada.chave),
  ]);
  assert.deepEqual([primeira.statusCode, segunda.statusCode].sort(), [200, 429]);
  assert.ok(Number([primeira, segunda].find(x => x.statusCode === 429)!.headers['retry-after']) >= 1);

  const expirada = await chave(org.id, ['rastreio_leitura']);
  await ambiente.prisma.chaveParceiro.update({ where: { id: expirada.id }, data: { expiraEm: new Date(0) } });
  assert.equal((await publica('GET', caminhoRastreio, expirada.chave)).statusCode, 401);
  assert.equal((await ambiente.api('DELETE', `/admin/chaves-parceiro/${r.id}`, tokens.admin)).statusCode, 200);
  assert.equal((await publica('GET', caminhoRastreio, r.chave)).statusCode, 401);
});

test('produz as três análises, processa concorrência e mantém histórico isolado', async () => {
  const lote = await ambiente.novoLote(tokens.alm, org.cnpj, 'AV3-ANALISE', ['CPU', 'CPU']);
  const [a, b] = lote.equipamentos.map(e => e.id);
  for (const id of [a, b]) {
    const inicio = await ambiente.api('PATCH', `/equipamentos/${id}/status`, tokens.alm, { status: 'em_triagem' });
    assert.equal(inicio.statusCode, 200, inicio.body);
  }
  for (const id of [a, b]) {
    const fim = await ambiente.api('POST', `/equipamentos/${id}/triagem`, tokens.alm);
    assert.equal(fim.statusCode, 200, fim.body);
  }
  const base = { marca: 'Marca A', modelo: 'Modelo B' };
  for (const [id, entrada] of [
    [a, { data: dia(-10), idadeDias: 0, estado: 'novo' }],
    [a, { data: dia(-5), idadeDias: 200, estado: 'bom', recuperacao: 150.13, custo: 50.13 }],
    [a, { data: dia(-1), idadeDias: 300, estado: 'bom', recuperacao: 200.13, custo: 50.13 }],
    [b, { data: dia(-3), idadeDias: 500, estado: 'sucata', falha: true }],
  ] as const) {
    const r = await ambiente.api('POST', `/analises/equipamentos/${id}/observacoes`, tokens.alm, { ...base, ...entrada });
    assert.equal(r.statusCode, 201, r.body);
  }
  const invalida = await ambiente.api('POST', `/analises/equipamentos/${b}/observacoes`, tokens.admin, {
    ...base, idadeDias: 300, estado: 'bom', recuperacao: 100.123, data: dia(-2),
  });
  assert.equal(invalida.statusCode, 400, invalida.body);

  const analise = await ambiente.api('GET', `/analises/organizacoes/${org.id}`, tokens.aud);
  assert.equal(analise.statusCode, 200, analise.body);
  assert.equal(analise.json().eficiencia.entradaAConclusao.lotes, 1);
  assert.equal(analise.json().eficiencia.porOperador.length, 1);
  assert.equal(analise.json().eficiencia.triagem.lotes, 1);
  assert.equal(analise.json().rentabilidade.grupos[0].recuperacaoMedia, 200.13);
  assert.equal(analise.json().rentabilidade.grupos[0].margemMedia, 150);
  assert.ok(analise.json().vidaUtil.grupos[0].idadeProjetadaDias > 300);
  assert.ok(analise.json().vidaUtil.grupos[0].vidaRemanescenteDias > 0);

  const segredo = (await chave(org.id, ['relatorios_leitura'])).chave;
  const vizinha = (await chave(outra.id, ['relatorios_leitura'])).chave;
  const pedido = await publica('POST', '/relatorios', segredo);
  assert.equal(pedido.statusCode, 202, pedido.body);
  const id = pedido.json().id;
  assert.equal(pedido.headers.location, `${PUBLICA}/relatorios/${id}`);
  assert.equal((await publica('GET', `/relatorios/${id}/download`, segredo)).statusCode, 409);
  assert.equal((await publica('GET', `/relatorios/${id}`, vizinha)).statusCode, 404);
  const { processarRelatorio, agendarRelatoriosDiarios } = await import('../src/modules/analise/relatorio.service');
  const falhaInesperada = (erro: unknown) => assert.fail(String(erro));
  assert.deepEqual((await Promise.all([processarRelatorio(falhaInesperada), processarRelatorio(falhaInesperada)])).sort(), [false, true]);
  const status = await publica('GET', `/relatorios/${id}`, segredo);
  assert.equal(status.json().situacao, 'concluido', status.body);
  assert.equal(status.json().tentativas, 1);
  const arquivo = await publica('GET', `/relatorios/${id}/download`, segredo);
  assert.equal(arquivo.statusCode, 200, arquivo.body);
  assert.match(String(arquivo.headers['content-disposition']), /attachment/);
  assert.equal(arquivo.json().rentabilidade.grupos[0].margemMedia, 150);
  assert.equal((await publica('GET', `/relatorios/${id}/download`, vizinha)).statusCode, 404);
  assert.equal((await publica('GET', '/relatorios', segredo)).json().itens[0].id, id);

  await Promise.all([agendarRelatoriosDiarios(), agendarRelatoriosDiarios()]);
  assert.equal(await ambiente.prisma.relatorioAnalitico.count({ where: { agendamento: dia(0) } }), 2);
});

test('fila recupera reservas expiradas e encerra após a terceira tentativa', async () => {
  const { processarRelatorio } = await import('../src/modules/analise/relatorio.service');
  const criarExpirada = (tentativas: number) => ambiente.prisma.relatorioAnalitico.create({
    data: {
      organizacaoId: org.id, situacao: 'processando', tentativas,
      disponivelEm: new Date(0), reservaAte: new Date(0),
    },
  });
  const recuperavel = await criarExpirada(1);
  const esgotada = await criarExpirada(3);
  await processarRelatorio(erro => assert.fail(String(erro)));
  const obtidos = await ambiente.prisma.relatorioAnalitico.findMany({ where: { id: { in: [recuperavel.id, esgotada.id] } } });
  assert.equal(obtidos.find(r => r.id === recuperavel.id)?.situacao, 'concluido');
  assert.equal(obtidos.find(r => r.id === recuperavel.id)?.tentativas, 2);
  assert.equal(obtidos.find(r => r.id === esgotada.id)?.situacao, 'falhou');
});

test('erros transitórios voltam para a fila com atraso progressivo', async () => {
  const { reagendarOuFalhar } = await import('../src/modules/analise/relatorio.repository');
  const tarefa = await ambiente.prisma.relatorioAnalitico.create({
    data: { organizacaoId: org.id, situacao: 'processando', tentativas: 1, reservaAte: new Date() },
  });
  await reagendarOuFalhar(tarefa);
  const adiada = await ambiente.prisma.relatorioAnalitico.findUniqueOrThrow({ where: { id: tarefa.id } });
  assert.equal(adiada.situacao, 'pendente');
  assert.equal(adiada.reservaAte, null);
  assert.ok(adiada.disponivelEm.getTime() >= tarefa.criadoEm.getTime() + 15_000);
});

// Patrick Jane: Jane testou a chave na sala errada. Lisbon anotou 404 no relatório de campo.
