# Arquivo — Domínio próprio do escritório (removido em 12/08/2026)

> **Por que foi removido:** decisão do usuário antes do merge do Bloco 7. A
> funcionalidade estava pronta e testada, mas **o cliente não a pediu** — na
> devolutiva (pergunta 3.4) o Michel marcou logo, nome, WhatsApp e "e-mails com
> a marca do escritório", e **não** marcou domínio próprio. Ela veio do PRD
> Master, não da lista dele.
>
> **Nada foi perdido.** Este documento é o mapa para recolocá-la.

## Onde está o código

Três cópias, de propósito — cada uma cobre uma falha diferente:

1. **Branch `arquivo/dominio-proprio`** — a árvore inteira no estado anterior à
   remoção (commit `c877ff6`). É a cópia mais fiel: contém os arquivos, o
   histórico e as mensagens de commit que explicam cada decisão.
2. **Patch `docs/arquivo/2026-08-12-dominio-proprio.patch`** — só os arquivos da
   feature, versionado junto do repositório. Sobrevive mesmo que a branch seja
   apagada.
3. **Migrations `0069` e `0074`**, que continuam no repositório e **não foram
   revertidas** — as colunas seguem no banco (ver abaixo).

## O que foi removido do código

| Arquivo | Destino |
|---|---|
| `src/lib/dominios/host.ts` (+ teste) | apagado |
| `src/lib/dominios/branding.ts` (+ teste) | apagado |
| `src/lib/dominios/provedor.ts` | apagado |
| `src/lib/dominios/verificacao.ts` (+ teste) | apagado |
| `src/app/api/dominio/verificacao/route.ts` | apagado |
| `src/app/(auth)/(gated)/contador/dominio-actions.ts` | **reduzido** — só `salvarSlaAction` sobreviveu |
| `.../configuracoes/DominioSlaForm.tsx` | virou `SlaForm.tsx`, só com a seção de SLA |
| `src/app/(public)/layout.tsx` | voltou ao original (sem marca por host) |
| `src/app/(auth)/layout.tsx` | removido o fallback de marca por host |

**O SLA de atendimento NÃO foi removido** — ele é do pilar 8, foi pedido, e
continua funcionando (configuração, exibição ao cliente e alerta no cron).

## O que ficou no banco

As colunas `dominio_customizado`, `dominio_status`, `dominio_token`,
`dominio_verificado_em` e `dominio_erro` **continuam em `contabilidades`**,
vazias e sem uso. Não foram derrubadas porque:

- apagar coluna é irreversível e não devolve nada em troca (elas não pesam);
- manter torna o retorno da feature uma questão de código, não de migration;
- nenhuma delas é exposta: a `0075` revogou os grants e derrubou as RPCs.

**O que a `0075` derrubou** (isto sim era superfície pública):

- `branding_por_host(text)` — era executável por `anon`;
- `dominio_token_por_host(text)` — idem;
- os `GRANT SELECT` das colunas de domínio para `authenticated`.

## Como recolocar

```bash
# opção A — a partir da branch (preferida: traz o histórico junto)
git checkout arquivo/dominio-proprio -- app/src/lib/dominios app/src/app/api/dominio

# opção B — a partir do patch
git apply docs/arquivo/2026-08-12-dominio-proprio.patch
```

Depois:

1. Restaurar o trecho de domínio em `contador/dominio-actions.ts` e a seção de
   domínio no formulário (hoje `SlaForm.tsx`).
2. Recriar as duas RPCs — o corpo delas está na migration `0069`, que continua
   no repositório: basta uma migration nova repetindo os `CREATE FUNCTION` e os
   `GRANT`, mais os `GRANT SELECT` das colunas (texto na `0074`).
3. Voltar o fallback `brandingDoHost()` em `src/app/(auth)/layout.tsx` e a marca
   por host em `src/app/(public)/layout.tsx`.
4. Rodar os testes arquivados (`host.test.ts`, `branding.test.ts`,
   `verificacao.test.ts` — 33 casos no total).

## Decisões que valem reler antes de recolocar

Estão nos comentários do código arquivado, mas as três que mais custaram a
chegar:

- **Sem middleware.** O host não decide *qual página*, só *qual marca* — e isso
  o layout resolve lendo `headers()`. Colocar código no caminho de toda
  requisição (inclusive os fluxos de auth) por causa de marca não paga o risco.
- **Host é pintura, não autorização.** Quem decide o que alguém vê é a RLS. No
  layout autenticado o host era **fallback**, nunca override: senão um cliente
  da contabilidade A que abrisse o domínio de B veria a marca de B sobre os
  dados dele — o que se lê como "B me atende", e é falso.
- **Verificação por HTTP, não por DNS.** Buscar o token no próprio host prova de
  uma vez DNS + TLS + "é este app que responde ali". Um TXT record provaria só
  posse do domínio.
- **Sem `unstable_cache` no branding por host.** Uma entrada de cache sem o host
  na chave serviria a marca de um escritório no domínio de outro.
