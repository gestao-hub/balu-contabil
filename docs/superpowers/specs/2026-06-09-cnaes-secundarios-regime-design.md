# CNAEs secundários na aba Regime tributário

**Data:** 2026-06-09
**Escopo:** exibição (read-only). O fluxo de busca/sync de CNAEs já existe.

## Problema

A relação de CNAEs da empresa (principal + secundários) já é buscada na BrasilAPI e
salva em `company_cnaes` durante o cadastro (`sincronizarCnaesEmpresa`). Mas a aba
**Regime tributário** das Configurações só mostra um input "CNAE principal"
(`empresas_fiscais.cnae_principal`) — os **secundários** salvos não aparecem em lugar
nenhum pro usuário. Falta apresentá-los.

## Decisões (com o usuário)

- Exibir **apenas os secundários** (o principal já tem o seu campo).
- Mostrar **o anexo de cada CNAE** (mesma regra do select da emissão).
- A lista fica **inline entre os campos** do form (logo abaixo do "CNAE principal"),
  visível sempre, mas **read-only** — nunca entra no modo de edição.
- Aplicar também um **formatador de CNAE** no input do "CNAE principal" (hoje sem máscara).

## Modelo de dados (já existente)

`company_cnaes(company_id, owner_user_id, codigo, descricao, tipo['principal'|'secundario'],
fonte, updated_at, deleted_at)`. Rótulo do anexo vem de `cnae_anexo(codigo, anexo_base,
fator_r)`: `fator_r` → "Anexo III/V — Fator R"; senão `anexo_base`; sem mapeamento → null
("a curar"). Mesma lógica de `listarCnaesEmpresaAction` (notas_fiscais/actions.ts).

## Mudanças

1. **`src/lib/format/masks.ts`** — novo `formatCnae(value)`: só dígitos, formata até 7 como
   `DDDD-D/DD` (ex.: `4299501` → `4299-5/01`). Teste em `masks.test.ts`.

2. **`src/lib/fiscal/company-cnaes.ts`** (novo, server-only) —
   `listarCnaesSecundariosEmpresa(supabase, companyId): Promise<CnaeSecundario[]>`,
   `CnaeSecundario = { codigo: string; descricao: string | null; anexoLabel: string | null }`.
   Lê `company_cnaes` (`tipo='secundario'`, `deleted_at IS NULL`, order por `codigo`) e junta
   `cnae_anexo` p/ o rótulo. (O `listarCnaesEmpresaAction` da emissão fica intocado.)

3. **`configuracoes/page.tsx`** — quando `active === 'regime'` e há empresa, carrega
   `listarCnaesSecundariosEmpresa(supabase, company.id)` e passa como prop
   `cnaesSecundarios` pro `RegimeTributarioForm`.

4. **`RegimeTributarioForm.tsx`** —
   - máscara `formatCnae` no input "CNAE principal" (formata no display/onChange; salva só
     dígitos, mantendo o formato atual do banco);
   - nova prop `cnaesSecundarios`; seção inline read-only "CNAEs secundários" abaixo do
     principal: cada item `código formatado — descrição` + badge com `anexoLabel`
     (badge "a curar" quando null). Vazio → nota discreta "Nenhum CNAE secundário registrado."

## Fora de escopo

Editar/adicionar/remover CNAE manualmente; botão de re-sincronizar da Receita nessa aba;
mexer no principal salvo ou no fluxo de emissão.

## Verificação

AL PISCINAS (`41a9c2a4…`) tem 5 secundários salvos (4322301, 4744005, 4744003, 4789005,
4120400) — confere a renderização da lista + anexos no navegador; confirma a máscara no
input do principal (`4299-5/01`).

## Adendo as-built (2026-06-09)

A população dos secundários estava **silenciosamente falhando** na criação: o `fetch` do Node
(undici) ia sem `User-Agent` e a BrasilAPI respondia **403**, então `consultarCnpjBrasilApi`
retornava null e gravava só o principal com `fonte='focus'` (curl funcionava por mandar o próprio
UA, o que mascarava). Correções:
- `brasilapi.ts`: adiciona `User-Agent` + retry/backoff (429/5xx/timeout; 403 = definitivo).
- `atualizarDadosReceitaAction` ("Atualizar da Receita") re-roda `sincronizarCnaesEmpresa` —
  caminho de recuperação para empresas cujo sync de criação falhou. Verificado na AL PISCINAS
  (5 secundários gravados com `fonte='brasilapi'`).
