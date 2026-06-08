# Spec — Gate inicial SERPRO na página /impostos

> **Data:** 2026-06-08
> **Regime coberto:** Simples Nacional (MEI fica sem alteração por ora)
> **Depende de:** `consultarDeclaracoesAction` já implementada (CONSDECLARACAO13 + PAGAMENTOS71)

## Problema / objetivo

A página `/impostos` de uma empresa Simples que nunca sincronizou com a SERPRO exibe várias
seções vazias (Competência Atual sem cálculo, Declarações sem dados, Histórico sem guias).
O único caminho para popular tudo é o botão "Consultar na SERPRO" — escondido no rodapé do
Histórico de guias, sem destaque.

Queremos substituir esse estado inicial por uma experiência focada: uma única mensagem
explicativa + botão "Atualizar" em evidência, que dispara o primeiro sync e então revela a
página completa.

## Solução

### Flag de controle

Coluna `sincronizacao_inicial_serpro_at timestamptz` em `empresas_fiscais`.

- `NULL` → empresa Simples nunca sincronizou → exibe o gate
- `NOT NULL` → já sincronizou → exibe a página normal

Fica em `empresas_fiscais` (e não em `companies`) porque é um estado de configuração fiscal,
não da empresa em si.

### Gate — lógica na page.tsx

Condição: `isSimples && !fiscal.sincronizacao_inicial_serpro_at`

Quando verdadeiro: renderiza apenas o `GateInicialSerpro` no lugar de todas as seções
(CompetenciaAtualCard, DeclaracoesSection, HistoricoGuias). O header da página permanece
(empresa, competência, link Folha).

MEI: nenhuma mudança.

### Componente `GateInicialSerpro` (client island)

```
┌──────────────────────────────────────────────┐
│                                              │
│   [ícone Download/Refresh]                  │
│                                              │
│   Traga seu histórico de declarações agora  │
│                                              │
│   Sincronize com a SERPRO para ver suas     │
│   guias e declarações anteriores.           │
│                                             │
│          [ Atualizar ]                      │
│                                              │
└──────────────────────────────────────────────┘
```

Comportamento do botão:
1. Chama `consultarDeclaracoesAction()` (já existente)
2. Se `ok` → chama `marcarSincronizacaoInicialAction()`
3. `router.refresh()` — revalida o server component, revela a página normal
4. Se erro → exibe toast com a mensagem de erro (sem marcar o flag)

### `marcarSincronizacaoInicialAction`

Server action mínima. Não recebe argumentos. Faz:

```ts
supabase
  .from('empresas_fiscais')
  .update({ sincronizacao_inicial_serpro_at: new Date().toISOString() })
  .eq('empresa_id', companyId)
  .is('deleted_at', null)
```

Separada da `consultarDeclaracoesAction` por dois motivos:
1. Não acopla o conceito "primeira vez" ao fluxo de consulta recorrente
2. Permite chamar o sync novamente (botão "Consultar na SERPRO" que já existe) sem
   regredir para o gate

### Migration

```sql
ALTER TABLE public.empresas_fiscais
  ADD COLUMN IF NOT EXISTS sincronizacao_inicial_serpro_at timestamptz;
```

Sem valor default — empresas existentes ficam com `NULL`, ativando o gate na próxima visita.
Isso é intencional: força o primeiro sync para popular `guias_fiscais` e `declaracoes_fiscais`.

## Arquitetura — arquivos

| Arquivo | Tipo | Ação |
|---|---|---|
| `supabase/migrations/NNNN_gate_inicial_serpro.sql` | migration | ADD COLUMN |
| `app/(auth)/impostos/page.tsx` | modificar | lê `sincronizacao_inicial_serpro_at`; branch do gate |
| `app/(auth)/impostos/GateInicialSerpro.tsx` | novo (client) | mensagem + botão Atualizar |
| `app/(auth)/impostos/actions.ts` | modificar | adicionar `marcarSincronizacaoInicialAction` |

## Fluxo detalhado

```
Usuário acessa /impostos (Simples, nunca sincronizou)
  → page.tsx: isSimples=true, sincronizacao_inicial_serpro_at=null
  → renderiza <GateInicialSerpro />

Clica "Atualizar"
  → consultarDeclaracoesAction()
      → CONSDECLARACAO13: upsert situacoes em guias_fiscais + declaracoes_fiscais
      → PAGAMENTOS71: upsert DAS pagos com valores em guias_fiscais
      → retorna { ok: true, count: N }
  → marcarSincronizacaoInicialAction()
      → update empresas_fiscais set sincronizacao_inicial_serpro_at = now()
  → router.refresh()
  → page.tsx recarrega: sincronizacao_inicial_serpro_at NOT NULL
  → renderiza página normal com dados populados
```

## Tratamento de erros

- `consultarDeclaracoesAction` falha → toast de erro, flag **não** marcado, gate permanece
- `marcarSincronizacaoInicialAction` falha → toast de aviso, mas dados já foram salvos;
  próxima visita mostrará o gate novamente — usuário pode clicar "Atualizar" de novo sem
  problema (a action é idempotente)
- Empresa sem certificado / sem procuração → erro vem da `consultarDeclaracoesAction`
  com mensagem amigável já existente

## Fora de escopo

- MEI (sem endpoint equivalente ao CONSDECLARACAO13; PAGAMENTOS71 MEI fica para depois)
- Sincronização de anos anteriores (a action já consulta o ano corrente; expansão futura)
- Reset do flag (admin/debug; desnecessário para v1)
