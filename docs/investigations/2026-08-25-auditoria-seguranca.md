# Auditoria de Segurança — Balu (plataforma inteira)

**Data:** 2026-08-25 · **Versão auditada:** `158ecf7` (main, sessão 32 parte 4)
**Ambiente:** **produção** (projeto Supabase `llykzqnugdpojwnlontj`, 4 empresas vivas)
**Autorizado por:** Walace, dono do projeto
**Credenciais usadas:** anon key pública (`sb_p…6QaZ`), conexão `postgres` direta
via runner node+pg lendo `SUPABASE_PASSWORD` do `app/.env.local`, e requisições
**sem credencial nenhuma** contra o Storage.

> **Limites respeitados:** nenhuma escrita foi comitada. A única transação de
> escrita (migration 0103) rodou com `ROLLBACK`. Nenhum dado de cliente foi
> extraído — as provas usam contagem de linhas, nome de coluna, status HTTP e
> `content-length`. Nenhum material de chave foi baixado: o teste do bucket usa
> `HEAD`, não `GET` de corpo.

---

## Resumo

A plataforma está, no banco, **bem construída**: RLS ligada em 48/48 tabelas,
zero tabela exposta sem RLS, zero view (o vetor clássico de bypass), 27 funções
`SECURITY DEFINER` todas com `search_path` fixo, e nenhum segredo de servidor
atravessando para o bundle do cliente. A separação de tenant se sustentou em
todos os pontos que tentei furar.

O problema não está no banco: está **fora dele**. O bucket
`company-certificates` é público. Os 4 certificados digitais A1 das empresas e o
certificado **contratante do SERPRO** — a credencial que vale pela plataforma
inteira — respondem `200` a um GET sem credencial alguma, e a anon key (que está
no bundle de toda página, por natureza) lista o bucket e entrega os caminhos.
Além disso, qualquer pessoa que crie uma conta pode **apagar ou substituir**
qualquer um desses certificados.

O conteúdo está cifrado em AES-256-GCM, e a chave não vazou — é o que separa
isto de um incidente de chave privada. Mas a defesa em profundidade foi a zero:
resta uma única barreira.

**Recomendação: aplicar a 0103 antes de qualquer outra coisa** — inclusive antes
de conectar o WhatsApp para o teste de ponta a ponta. É uma migration, os checks
já passaram em modo rollback, e nenhum caminho do produto depende do que ela
fecha.

| Classificação | Qtd |
|---|---|
| Explorável agora | 2 |
| Bomba armada | 3 |
| Higiene | 3 |
| Provado seguro | 9 |
| Não verificado | 6 |

---

## Explorável agora

### 1. 🔴 Bucket `company-certificates` é público — certificados A1 e o contratante do SERPRO baixáveis sem credencial

**Como reproduzir** (qualquer pessoa, de qualquer lugar):

```bash
# passo 1 — a anon key sai do bundle de qualquer página do app (é pública por design)
# passo 2 — listar o bucket, só com ela:
curl -s -X POST 'https://llykzqnugdpojwnlontj.supabase.co/storage/v1/object/list/company-certificates' \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H 'Content-Type: application/json' -d '{"prefix":"","limit":100,"offset":0}'

# passo 3 — baixar, agora SEM credencial nenhuma:
curl -I 'https://llykzqnugdpojwnlontj.supabase.co/storage/v1/object/public/company-certificates/<uuid>/certificado.enc'
```

**Saída obtida:**

```
listagem com anon key -> 200  6 item(ns)
      - .emptyFolderPlaceholder
      - 3f7370a5-bfdc-4d3b-b59d-9165967d28c8
      - 41a9c2a4-241f-40b0-a1c5-da3fced49359
      - 44bd4761-76f3-4288-be34-b8412a072195
      - 967eda7e-f504-4585-be24-666bc2c9b215
      - system

HEAD sem credencial:
  200  [company-certificates] 41a9c2a4-…/certificado.enc      len=4736   type=application/octet-stream
  200  [company-certificates] 967eda7e-…/certificado.enc      len=4736
  200  [company-certificates] 44bd4761-…/certificado.enc      len=4736
  200  [company-certificates] 3f7370a5-…/certificado.enc      len=4736
  200  [company-certificates] system/serpro-contratante.enc   len=11996
```

**Por que o caminho não protege.** A defesa aparente era o UUID no path. Ela não
existe: a API de listagem aceita a anon key e devolve as pastas. O atacante não
adivinha o caminho — ele o recebe.

**O que mitiga, dito com precisão.** Os arquivos são `iv‖authTag‖ciphertext`
AES-256-GCM (`lib/crypto/envelope.ts`), e `CERT_ENC_KEY` é segredo de servidor —
**provei que ela não está no bundle** (achado PS-3). Então o que vazou é
ciphertext, não a chave privada A1. A gravidade é "defesa em profundidade
zerada", não "chave privada exposta". Mas a partir daqui um único vazamento de
`CERT_ENC_KEY` vira 4 certificados A1 de cliente + o contratante do SERPRO, sem
nenhum passo intermediário.

**Dado pessoal:** sim — certificado A1 identifica CNPJ e responsável legal.
Se a decisão for que houve incidente, o prazo da LGPD começa a contar.

**Correção:** `app/supabase/migrations/0103_fecha_bucket_certificados.sql`
(escrita, provada em rollback, **ainda não aplicada**).

---

### 2. 🔴 Qualquer conta autenticada apaga ou substitui o certificado de qualquer empresa

**Evidência** — as policies, lidas do banco vivo:

```
[DELETE] Authenticated Delete company-certificates {authenticated}
    USING (bucket_id = 'company-certificates'::text)
[UPDATE] Authenticated Update company-certificates {authenticated}
    USING (bucket_id = 'company-certificates'::text)
[INSERT] Authenticated Upload company-certificates {authenticated}
    CHECK (bucket_id = 'company-certificates'::text)
[SELECT] Public Read company-certificates {public}
    USING (bucket_id = 'company-certificates'::text)
```

Nenhuma das quatro olha dono. A qual de `DELETE` é **textualmente idêntica** à
de `SELECT`, e a de `SELECT` devolveu os 6 objetos — logo o `DELETE` casa os
mesmos 6. O cadastro é aberto (`/cadastro`), então virar `authenticated` custa
um e-mail.

**Impacto:** apagar o `system/serpro-contratante.enc` derruba a integração SERPRO
da plataforma inteira. Substituir o certificado de uma empresa por outro arquivo
quebra a emissão fiscal dela de forma silenciosa — o upload é `upsert:true`.

**Não executei o `DELETE`.** É produção com dado real, e a prova pela qual optei
(comparação das quals, avaliada contra o conjunto que o `SELECT` devolve) é
conclusiva sem destruir nada.

**Correção:** a mesma 0103 — as quatro policies caem. Ninguém além do
`service_role` precisa tocar neste bucket, e `service_role` não é barrado por RLS.

---

## Bomba armada

### 3. 🟡 `user_metadata` alimenta o papel do usuário, e o usuário pode zerar a fonte canônica

`lib/auth/gate-context.ts:26`:

```ts
const rawRole = (roleRow?.type as string | null) ?? (user.user_metadata?.type as string | null) ?? '';
```

`user_metadata` é gravável pelo próprio dono da sessão via GoTrue
(`PUT /auth/v1/user`), com a anon key. O fallback só dispara quando **não há**
linha em `role_types` — e a policy deixa o usuário apagar a própria:

```
[DELETE] role_types_delete {public} USING (user_id = auth.uid())
```

O trigger `tg_role_types_protege_admin` dispara em `BEFORE INSERT OR UPDATE` —
**não em DELETE**. Cadeia: apaga a própria linha → grava
`user_metadata.type = 'AdminBalu'` → `normalizedRole === 'adminbalu'`.

**O que isso alcança hoje — e o que não alcança.** Não alcança dado. Os guards
reais (`requireAdminBaluPage`, `requireAdminBaluAction`) releem `role_types`
direto, e a RLS escopa tudo. O efeito real é: menu de admin na sidebar,
onboarding pulado, e um laço de redirect (`(gated)/page.tsx` manda pra `/admin`,
`requireAdminBaluPage` manda de volta pra `/`) que inutiliza a própria conta.

É bomba armada porque um valor **escolhido pelo atacante** alimenta uma variável
chamada `role`. O dia em que um guard novo confiar em `normalizedRole` em vez de
reler `role_types`, isto vira escalada completa — e quem escrever esse guard vai
achar que está lendo o papel do usuário.

**Correção:** apagar o fallback e escopar `role_types`:

```ts
// lib/auth/gate-context.ts
const rawRole = (roleRow?.type as string | null) ?? '';
```

```sql
drop policy if exists role_types_delete on public.role_types;
drop policy if exists role_types_update on public.role_types;
drop policy if exists role_types_insert on public.role_types;
-- a linha nasce do trigger handle_new_user_role; ninguém precisa escrevê-la à mão
```

### 4. 🟡 As quatro policies e o bucket nunca estiveram numa migration

`grep` em `app/supabase/migrations/*.sql` não encontra **uma linha** citando
`company-certificates`. O bucket e suas policies foram criados no painel. A única
declaração daquilo no repositório é um comentário em
`lib/clients/supabase-storage.ts:24` que chama o bucket de "**privado**".

É a causa-raiz dos achados 1 e 2, e é o padrão que vai reproduzi-los: o que vive
só no painel não tem revisão, não tem teste, não tem histórico e não aparece em
diff. **Zero testes tocam configuração de bucket** — conferido.

**Correção:** além da 0103, adotar a regra de que configuração de bucket entra
por migration. Um teste barato que morde: uma asserção contra
`storage.buckets.public` e a contagem de policies do bucket, junto dos testes de
RLS que já existem em `tests/`.

### 5. 🟡 Token do escritório trafega na query string do webhook

`api/webhooks/uazapi/route.ts` autentica o canal por `?t=<64 hex>`. É credencial
bearer numa URL: cai em log de acesso da Vercel, em log de saída da uazapi e em
qualquer proxy do caminho. Quem obtiver esse log injeta mensagens forjadas no
atendimento daquele escritório e dispara a IA em nome dele.

O formato é conferido (256 bits, `/^[0-9a-f]{64}$/`) e o valor é validado contra
o banco — a construção está certa. O problema é o canal de transporte.

**Correção:** aceitar o token também por header (`x-balu-canal`) e migrar o
provisionamento, mantendo a query como fallback até os canais existentes
rodarem. E garantir que exista rotação: hoje não achei caminho de troca do token
de um escritório já provisionado.

---

## Higiene

### 6. 5 CVEs de severidade alta em dependências de produção

```
next    9.3.4-canary.0 – 16.3.0-preview.10   (8 advisories)
  · SSRF in Server Actions on custom servers
  · Cache confusion of response bodies for requests with bodies
  · Unauthenticated disclosure of internal Server Function endpoints
  · DoS in App Router using Server Actions
postcss <=8.5.22   · path traversal via sourceMappingURL → leitura de .map arbitrário
sharp   <0.35.0    · CVEs herdadas do libvips
nanoid             · loop infinito com size negativo/zero
```

O `package.json` fixa `next: ^15.0.0`. `npm audit fix` resolve os quatro.
**Não classifiquei como explorável** porque não testei nenhuma delas contra este
deploy — a "unauthenticated disclosure of internal Server Function endpoints"
merece um teste dirigido depois do upgrade.

### 7. Comparação de segredo de cron não é em tempo constante

As quatro rotas `api/cron/*` fazem `(req.headers.get('authorization') ?? '') !== \`Bearer ${secret}\``.
Os webhooks fazem certo (`timingSafeEqual`, em `api/webhooks/segredo.ts`).
Já era decisão registrada; fica o registro de que a assimetria continua.

### 8. `abertura-documentos` e os demais buckets privados sem teto de tamanho ou MIME

`file_size_limit = null` e `allowed_mime_types = null` em todos os buckets. O
upload de abertura passa por `uploadAberturaDoc`, que tem guarda de path
traversal, mas nada limita tamanho no lado do Storage.

---

## Provado seguro

Cada item abaixo teve um ataque tentado; a defesa respondeu.

| # | O que foi tentado | O que respondeu |
|---|---|---|
| PS-1 | `SELECT` anônimo com a anon key real nas 32 tabelas alcançáveis | 30 devolveram `linhas=0` (policy filtrou), 1 devolveu `401/42501`. Só 2 devolvem linha: `documento_versoes` (só `publicado_em IS NOT NULL` — termos e privacidade) e `parametros_fiscais` (tetos do Simples, informação pública de norma). Ambas públicas de propósito. |
| PS-2 | Tabela sem RLS alcançável pelo PostgREST | **0 de 48**. RLS ligada em todas. |
| PS-3 | 7 segredos de servidor (`SERVICE_ROLE_KEY`, `CERT_ENC_KEY`, os 3 de webhook, `CRON_SECRET`, `SUPABASE_PASSWORD`) procurados pelo valor literal nos 99 arquivos JS do bundle | **0 ocorrências** para cada um. Só a anon key aparece, como deve. |
| PS-4 | Mudar de escritório escrevendo em `contabilidade_membros` | A tabela só tem policy de `SELECT`. O `GRANT` de INSERT/UPDATE/DELETE existe, mas sem policy a RLS nega. |
| PS-5 | Estender o próprio trial escrevendo em `assinaturas` | Idem: só `SELECT`. |
| PS-6 | Auto-promoção a `AdminBalu` via `role_types` | Trigger `tg_role_types_protege_admin` com `current_user NOT IN ('service_role','postgres','supabase_admin')`. Índice `UNIQUE(user_id)` **existe** (o CHECKPOINT diz que faltava — está desatualizado nesse ponto) e não há duplicata. |
| PS-7 | Sequestro de `search_path` em `SECURITY DEFINER` | 27 funções, **todas** com `search_path` fixo. 0 views/matviews em `public` (o bypass clássico de RLS não tem onde morar). |
| PS-8 | Webhook com segredo vazio / ataque de timing | `iguais()` retorna `false` quando `esperado` é vazio, confere comprimento antes e usa `timingSafeEqual`. Fail-open fechado. |
| PS-9 | IDOR em `api/contador/logo` e segredo em `.env.example` rastreado | O `contabilidadeId` vem de `getContabilidadeCtx()` (servidor), nunca do cliente; magic bytes conferidos, SVG recusado. O `.env.example` no git tem **0 linhas** com valor de 16+ chars — o incidente antigo está fechado. |

---

## Não verificado

O que segue **não foi testado**, com o motivo. É a parte do relatório que diz
onde você continua no escuro.

1. **Prova C — se os testes mordem.** Desativei `requireAdminBaluAction` de
   propósito para rodar a suíte e ver se ficava vermelha; **o classificador do
   modo automático bloqueou a execução do vitest** e restaurei o arquivo
   (`git diff` vazio, conferido). Pela leitura: os 13 arquivos de teste que
   tocam o guard fazem `vi.mock('@/lib/admin/guard', …)`, ou seja, substituem o
   módulo inteiro. Eles provam que **cada action honra o veredito** do guard —
   não que o guard **produz** o veredito certo. Esvaziar `guard.ts` muito
   provavelmente deixa os 13 verdes. Isso precisa da execução para virar achado.
2. **Variáveis de produção na Vercel.** Não consigo ler. Em aberto: se
   `CERT_ENC_KEY` em produção é a mesma do `.env.local` (se for, a chave que
   protege o ciphertext do achado 1 está num arquivo de máquina de
   desenvolvimento, com 8 cópias `.bak` ao lado).
3. **Se os 4 certificados estão realmente cifrados.** Provei a exposição por
   `HEAD` e não baixei corpo. O caminho de escrita (`lib/fiscal/cert-upload.ts:94`)
   chama `encryptBlob`, e a extensão é `.enc` — mas não conferi os bytes.
4. **Configuração de Auth do Supabase** — confirmação de e-mail ligada?, política
   de senha (o app aceita 6 caracteres), proteção contra senha vazada, expiração
   de OTP. Não são legíveis pelo runner de banco.
5. **DAST na aplicação rodando** — nada foi testado contra o app no ar: XSS,
   CSRF em server actions, o comportamento real das CVEs do Next.
6. **Os 19 objetos de `abertura-documentos`** — bucket privado com 0 policies
   (nega tudo fora do `service_role`), mas não bati nele com a anon key para
   confirmar.

---

## Ordem sugerida

1. **0103** — fecha os achados 1 e 2. Já provada em rollback; nada no produto depende do que ela remove.
2. **Rotacionar** os 4 certificados A1 e o contratante do SERPRO, se a decisão
   for tratar a exposição como incidente. Depende de você e dos clientes, não de código.
3. **Achado 3** — duas linhas de código e três `drop policy`.
4. **`npm audit fix`** + rodar a linha de base (`tsc && vitest && build` a partir de `app/`).
5. **Prova C** de verdade, sem o bloqueio — é ela que diz se a suíte de 2183
   testes protege os guards ou só os acompanha.
