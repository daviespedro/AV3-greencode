# greencode · Guia de demonstração da AV3

## Instalação e execução

Use Node.js 22 LTS e PostgreSQL 14 ou superior. Os comandos npm funcionam no PowerShell e em shells Linux e macOS. O projeto pode usar um PostgreSQL instalado na máquina ou o PostgreSQL embutido de desenvolvimento da AV2.

1. Abra um terminal na pasta do projeto e rode `npm ci` e `npm run pg`. Deixe o processo do PostgreSQL aberto. Se já tiver um servidor, configure `DATABASE_URL` no arquivo `.env` e dispense o comando `npm run pg`.
2. Em outro terminal, rode `npm run db:setup`. Esse comando prepara o `.env`, aplica as migrações e carrega o seed em um banco vazio. Em banco com dados da AV2, faça o backup de rotina e execute `npm run db:migrate` com o `DATABASE_URL` existente.
3. Inicie a API com `npm run dev`. Em outro terminal, inicie o processamento e o agendamento com `npm run dev:worker`.
4. Abra [Swagger UI](http://localhost:3000/docs). O [OpenAPI exclusivo para parceiros](http://localhost:3000/openapi-public.json) também está disponível em `docs/openapi-public.json`.

Em execução compilada, rode `npm run build`, `npm run db:migrate`, `npm start` e `npm run start:worker`. Os dois últimos comandos são processos independentes. Use os logins do seed somente em desenvolvimento.

## Demonstração no Swagger

1. Em `POST /api/v1/auth/login`, use `{"username":"admin","senha":"Greencode#2026"}` para o seed padrão. Em **Authorize**, cole o token no esquema **bearerAuth**.
2. Em `GET /api/v1/organizacoes`, copie o ID de **Banco Horizonte S.A.**. Em `GET /api/v1/analises/organizacoes/{id}`, consulte a eficiência, a rentabilidade e a previsão geradas com os dados fictícios do lote `NF-0002`.
3. Em `POST /api/v1/admin/chaves-parceiro`, envie o ID da organização e os escopos. Copie o campo `chave` da resposta e cole em **Authorize → parceiroApiKey**.

```json
{
  "organizacaoId": "SUBSTITUA_PELO_UUID_DA_ORGANIZACAO",
  "nome": "Integração de demonstração",
  "escopos": ["rastreio_leitura", "lotes_escrita", "relatorios_leitura"],
  "limiteMinuto": 60,
  "validadeDias": 90
}
```

4. Em `POST /api/v1/public/lotes`, use uma NF nova naquela organização. Copie o ID do lote e os IDs de equipamentos da resposta para consultar `GET /api/v1/public/lotes/{id}` e `GET /api/v1/public/equipamentos/{id}/rastreio`.

```json
{
  "nf": "NF-PARCEIRO-001",
  "transportadora": "TransVerde",
  "equipamentos": [{"tipo":"notebook"}]
}
```

5. Execute `POST /api/v1/public/relatorios`. A API responde `202` e devolve a URL da tarefa no cabeçalho `Location`. Consulte `GET /api/v1/public/relatorios/{id}` a cada poucos segundos. Quando `situacao` for `concluido`, execute `GET /api/v1/public/relatorios/{id}/download` para baixar o JSON.
6. Consulte `GET /api/v1/public/relatorios` para ver o histórico, inclusive o relatório agendado do dia. O campo `agendamento` identifica a data UTC da execução programada.
7. Para revogar o acesso, execute `DELETE /api/v1/admin/chaves-parceiro/{id}` com o JWT de administrador e o ID da chave.

## Contrato de integração

Base pública `/api/v1/public`. Envie a credencial no cabeçalho `x-api-key`.

| Operação | Escopo | Sucesso |
| --- | --- | --- |
| `POST /lotes` | `lotes_escrita` | 201 e `Location` |
| `GET /lotes/{id}` | `rastreio_leitura` | 200 |
| `GET /equipamentos/{id}/rastreio` | `rastreio_leitura` | 200 e movimentações paginadas |
| `POST /relatorios` | `relatorios_leitura` | 202 e `Location` |
| `GET /relatorios` | `relatorios_leitura` | 200 e histórico paginado |
| `GET /relatorios/{id}` | `relatorios_leitura` | 200 e situação |
| `GET /relatorios/{id}/download` | `relatorios_leitura` | 200 e arquivo JSON |

O status 400 indica validação, 401 indica credencial inválida ou inativa, 403 indica escopo ausente e 404 cobre recursos ausentes ou de outra organização. O status 409 cobre conflitos como NF repetida ou resultado indisponível. Em 429, espere o número de segundos indicado por `Retry-After`. `X-RateLimit-Reset` é o instante de reinício em segundos Unix. Os cabeçalhos `X-RateLimit-Limit` e `X-RateLimit-Remaining` indicam a cota e o saldo da janela.

A chave vence na data de `expiraEm`. Para rotacionar, emita outra chave, atualize o cliente e revogue a anterior. A organização e a conta administradora que emitiu a chave precisam estar ativas, e a conta precisa continuar com o papel `admin`. Em implantação externa, use HTTPS e mantenha credenciais fora das URLs e do código-fonte.

## Registros analíticos

`POST /api/v1/analises/equipamentos/{id}/observacoes` aceita JWT de `admin` ou `almoxarifado`. Use a data real da medição em `AAAA-MM-DD` e a idade real de uso em dias nessa data. O campo `falha` representa uma falha que tornou o equipamento inservível. `recuperacao` e `custo` são opcionais e expressos em reais. Cada equipamento aceita uma observação por data. Uma organização preexistente precisa registrar esses valores para alimentar a rentabilidade e a previsão.

```json
{
  "data": "2026-11-20",
  "idadeDias": 365,
  "marca": "Marca Demo",
  "modelo": "CPU-100",
  "estado": "regular",
  "falha": false,
  "recuperacao": 210,
  "custo": 50
}
```

`GET /api/v1/analises/organizacoes/{id}` calcula uma visão atual com JWT de `admin` ou `auditor`. A fila grava cada execução como um relatório independente. O resultado inclui a versão do modelo, a data do cálculo e a cobertura das amostras.

## Verificação

- `npm run build` verifica o TypeScript e gera o cliente Prisma.
- `npm run test:av3` verifica o contrato público, a autenticação por chave, o isolamento entre organizações, as três análises e a fila.
- `npm test` roda também a suíte de regressão da AV2. Os testes de integração usam bancos temporários.
- `npm run docs:openapi` atualiza os dois arquivos OpenAPI.
