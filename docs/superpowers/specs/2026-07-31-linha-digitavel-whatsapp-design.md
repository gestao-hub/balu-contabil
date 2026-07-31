# Spec — Linha digitável do DAS na mensagem de WhatsApp de vencimento

> **Data:** 2026-07-31 · **Origem:** item registrado no PRD Master (Bloco 6,
> pilar 4/6) como "pagamento do DAS via WhatsApp (Pix Copia-e-Cola)" — a
> premissa original (SERPRO devolve Pix na guia) foi investigada e refutada
> nesta sessão (ver §1). Esta spec cobre a versão real do item, com o dado
> que a SERPRO de fato devolve.
> **Estado:** desenho fechado, pronto para virar plano
> **Depende de:** nada bloqueia esta spec — todo o dado necessário já existe
> em produção (`guias_fiscais.linha_digitavel`), sem credencial nova.

---

## 1. Por que não é Pix

O PRD Master (§4, Bloco 6, escopo C2) descreve: *"enviar o Pix Copia-e-Cola
do DAS (o SERPRO já retorna o código na geração da guia) na mensagem de
vencimento"*. Essa premissa foi conferida nesta sessão contra:

- o parser real da resposta do SERPRO já em produção
  (`src/lib/fiscal/serpro-das-simples-parse.ts`, `das-mei-parse.ts`) —
  estrutura confirmada contra resposta real (comentário no próprio arquivo:
  *"Estrutura REAL do GERARDAS12, confirmada AL PISCINAS 202604"*): devolve
  `codigoDeBarras` (array) + `pdf`, **sem nenhum campo de Pix**;
- uma constante já mapeada mas nunca chamada, `GERAR_DAS_COBR:
  'GERARDASCOBRANCA17'` (`src/lib/clients/serpro.ts:162`), que parecia uma
  pista de um serviço "de cobrança" mais rico — investigado via documentação
  oficial da SERPRO (`apicenter.estaleiro.serpro.gov.br`) e a biblioteca
  `serpro_integra_contador_api` (que tipa os campos reais dessa resposta):
  `DasCobranca{pdf, cnpjCompleto, detalhamento{periodoApuracao,
  numeroDocumento, dataVencimento, dataLimiteAcolhimento, valores,
  observacao1-3, composicao}}` — **também sem Pix, e nem sequer com
  código de barras**. É uma variante de "aviso de cobrança", não um meio de
  pagamento.
- uma sondagem ao vivo contra o SERPRO Trial (mesmas credenciais que já
  emitem DAS em produção) devolveu 403 "API Subscription validation failed"
  — não só para `GERARDASCOBRANCA17`, mas também para `GERARDAS12`, que
  sabemos que funciona. **Achado à parte, não bloqueia esta spec**: as
  credenciais de Trial deste projeto parecem ter perdido acesso de
  assinatura desde a última vez que alguém chamou a API — registrado como
  pendência para o usuário investigar no portal da SERPRO, sem relação com
  o item de Pix.

**Conclusão:** a SERPRO não oferece Pix Copia-e-Cola para DAS em nenhum
serviço identificado. O que existe de verdade, já persistido em produção, é
`guias_fiscais.linha_digitavel` — a linha digitável do boleto, no formato
padrão de copiar-e-colar (`85810.00019 03605.xxxxxx ...`). Muitos aplicativos
bancários aceitam colar isso e processam o pagamento (por vezes rotulado
"pagar com Pix" pelo próprio banco, via um recurso interno de conciliação
de arrecadação — mas isso é decisão do banco do cliente, não algo que a Balu
controla ou pode prometer).

**Esta spec entrega:** a linha digitável, já gerada e já salva, anexada à
mensagem de WhatsApp de aviso de vencimento do DAS. Nenhuma integração nova,
nenhuma credencial nova.

---

## 2. Escopo

**Dentro do escopo:**
- A mensagem de WhatsApp proativa disparada pelo cron de obrigações
  (`api/cron/obrigacoes/route.ts`) para notificações de tipo `das_a_vencer`
  ou `das_vencido` passa a incluir a linha digitável da guia, quando
  disponível.

**Fora do escopo (decisão do usuário na sessão de brainstorming):**
- Atendimento por IA no WhatsApp (Bloco 6B): a IA não passa a mencionar a
  linha digitável em conversa. Continua restrita ao texto já calculado que
  já usa hoje (`buscarSituacaoAtualMei`).
- E-mail (Bloco 1): o template de e-mail (`lib/notifications/email-template.ts`)
  não muda. Fica registrado como possível item futuro, não construído agora.
- Qualquer geração de Pix de verdade (via PSP próprio ou outro caminho): fora
  de escopo por completo — mudaria a arquitetura (a Balu passaria a
  intermediar/gerar uma cobrança, o que esbarra no mesmo princípio já
  aplicado no Bloco 4, "a Balu não intermedia dinheiro de terceiro").

---

## 3. Desenho

### 3.1 Onde o dado já existe

A notificação `das_a_vencer`/`das_vencido` só é materializada quando **já
existe uma guia** em `guias_fiscais` (`materializar_obrigacoes`,
`0045b_rpc_materializar.sql`): a CTE `guias` lê de `guias_fiscais`, e o
`INSERT` grava `entidade_ref = gid::text` (o `id` da guia). Ou seja, no
momento em que essa notificação é criada, a guia — com `linha_digitavel` já
preenchida por `gerarDasMeiAction`/`gerarDasSimplesAction`
(`impostos/actions.ts`, `linha_digitavel: d.codigoDeBarras.join(' ')`) — já
existe. Não é preciso gerar nada novo, só ler o que já está lá.

### 3.2 Migration `0064` — RPC `notificacoes_pendentes_whatsapp` ganha o campo

`notificacoes_pendentes_whatsapp` (`0061_whatsapp.sql`) hoje devolve
`id, owner_user_id, tipo, titulo, corpo, action_href, whatsapp_numero` — sem
`entidade_ref` nem nada de `guias_fiscais`. A migration `0064` faz
`CREATE OR REPLACE FUNCTION` da mesma RPC, acrescentando:

- coluna nova no `RETURNS TABLE`: `linha_digitavel text`;
- um `LEFT JOIN public.guias_fiscais g ON g.id = (CASE WHEN n.tipo IN
  ('das_a_vencer', 'das_vencido') THEN n.entidade_ref END)::uuid` — o `CASE`
  garante que o `::uuid` só é tentado para os dois tipos que sabemos que
  gravam um `entidade_ref` de guia real; para qualquer outro tipo, o `CASE`
  devolve `NULL` e `NULL::uuid` nunca lança;
- `g.linha_digitavel` no `SELECT` (fica `NULL` via `LEFT JOIN` quando não
  há guia, quando a guia não tem linha digitável, ou quando o tipo não é
  DAS).

**Landmine registrado:** o `CASE` acima assume que todo `entidade_ref` de
`das_a_vencer`/`das_vencido` é sempre um UUID válido de uma guia real — hoje
é verdade (é o único writer, sempre grava `gid::text`), mas se um bug futuro
gravar um `entidade_ref` malformado nesses dois tipos específicos, o cast
lança e quebra a RPC inteira (não só a notificação afetada). Aceitável para
esta versão porque é o mesmo padrão de confiança já usado em `chave` (que
também deriva de `gid::text` sem validação extra) — mas vale registrar no
plano como suposição, não redescobrir depois.

### 3.3 `api/cron/obrigacoes/route.ts` — mensagem com a linha digitável

O loop de WhatsApp (linhas ~76-96) hoje monta:

```ts
texto: `${n.titulo}\n\n${n.corpo}${n.action_href ? `\n\n${siteUrl}${n.action_href}` : ''}`,
```

Passa a ser (nova função pura, testável sem mock de rede):

```ts
function montarTextoWhatsapp(n: {
  titulo: string; corpo: string; action_href: string | null; linha_digitavel: string | null;
}): string {
  const linhas = [n.titulo, '', n.corpo];
  if (n.linha_digitavel && n.linha_digitavel.trim()) {
    linhas.push('', 'Código para pagar (copie e cole no app do seu banco):', n.linha_digitavel.trim());
  }
  if (n.action_href) linhas.push('', `${siteUrl}${n.action_href}`);
  return linhas.join('\n');
}
```

Quando `linha_digitavel` é `null`/vazia (guia sem valor, legado, ou tipo que
não é DAS), o texto sai idêntico ao de hoje — sem regressão.

---

## 4. Testes

Não existe hoje nenhum arquivo de teste para `api/cron/obrigacoes/route.ts`
(confirmado nesta sessão, durante o fechamento do smoke do 6B — é uma lacuna
pré-existente, não desta feature). Para esta mudança, o plano deve criar
`api/cron/obrigacoes/route.test.ts` cobrindo, no mínimo, a função pura
`montarTextoWhatsapp` (sem precisar mockar `createAdminClient`/`rpc`/rede
inteiros — a extração acima existe justamente para isolar a lógica testável
da orquestração):

1. Notificação DAS com `linha_digitavel` preenchida → texto inclui a seção
   "Código para pagar" com o valor exato.
2. Notificação DAS com `linha_digitavel` `null` → texto igual ao formato
   atual (sem a seção).
3. Notificação DAS com `linha_digitavel` como string vazia (`''`) → mesmo
   tratamento do caso 2 (trata vazio como ausente).
4. `action_href` presente + `linha_digitavel` presente → as duas seções
   aparecem, na ordem certa (código antes do link, como no desenho).

A migration em si (join novo) é verificada por probe manual (mesmo padrão
dos outros blocos): inserir uma notificação `das_a_vencer` de teste
apontando para uma guia real com `linha_digitavel` conhecida, chamar a RPC
direto por SQL, e conferir que a linha volta com o campo certo — antes de
reverter o dado de teste.

---

## 5. Critério de aceite

- Uma notificação `das_a_vencer`/`das_vencido` cuja guia tem
  `linha_digitavel` preenchida gera uma mensagem de WhatsApp com a seção
  "Código para pagar" e o valor exato da linha digitável daquela guia.
- Qualquer outra notificação (outro tipo, ou DAS sem linha digitável) sai
  exatamente como hoje.
- Nenhuma mudança no atendimento por IA nem no e-mail.
- `tsc` 0, suíte verde incluindo o teste novo de `montarTextoWhatsapp`,
  `next build` limpo.

---

## 6. Pendência registrada, fora desta spec

As credenciais SERPRO Trial deste projeto (`SERPRO_CONSUMER_KEY`/
`SERPRO_CONSUMER_SECRET` em `.env.local`) devolveram 403 "API Subscription
validation failed" para `GERARDAS12` numa sondagem ao vivo nesta sessão —
mesmo serviço que a documentação de status do projeto registra como
funcionando. Vale o usuário confirmar no portal da SERPRO se a assinatura
Trial expirou ou precisa de renovação, **antes** de qualquer trabalho futuro
que dependa de chamar a SERPRO ao vivo (inclui o Bloco 5, produção fiscal).
Não é bloqueio desta spec porque nada aqui chama a SERPRO — só lê
`linha_digitavel` já persistida de guias já geradas anteriormente.
