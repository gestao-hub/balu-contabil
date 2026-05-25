# Etapa 2 — Plano: `bubble → código (Next.js ou PHP)`

> Aprovação pendente. Esta página descreve o pipeline proposto; nenhum código é gerado até você aprovar.

## Princípio guia

O `.bubble` é uma **árvore declarativa** (elementos, propriedades, workflows). Um app web moderno é a mesma árvore expressa em **componentes + rotas + handlers**. A conversão é tradução estruturada — não geração criativa. Logo: **slicer + templates + LLM apenas para o que é ambíguo**.

## Pipeline proposto

```
slices/ + PRD-App.md
        │
        ▼
┌──────────────────────────────────────────┐
│ 1. SCHEMA — Python                       │
│   slices/03_user_types + 07_api_connector│
│   → SQL Supabase (CREATE TABLE + RLS)    │
│   → enums TypeScript (option_sets)       │
│   → tipos Zod                            │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│ 2. ROUTING — Python                      │
│   slices/01_pages → estrutura de rotas   │
│   (Next.js app/) ou (PHP rotas)          │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│ 3. COMPONENTS — Claude + skill           │
│   slices/02_reusables + 05_styles        │
│   → React components (1 por reusable)    │
│   → tailwind tokens de 06_design_tokens  │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│ 4. PAGES — Claude (1 por behavior)       │
│   PRD §7–13 + slices/08_workflows_index  │
│   → src/pages/<page>/<behavior>/         │
│   seguindo CLAUDE.md (thin client,       │
│   1 behavior por pasta, test-first)      │
└──────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────┐
│ 5. API CLIENTS — Python                  │
│   slices/07_api_connector                │
│   → src/lib/clients/*.ts (Supabase,      │
│      Focus NFe, Serpro Integra, n8n)     │
│   tipos derivados do schema              │
└──────────────────────────────────────────┘
```

## Skills novas a criar

| Skill | Input | Output |
|---|---|---|
| `bubble-schema` | slices/03 + slices/07 | `supabase/migrations/*.sql` + `types/*.ts` |
| `bubble-routing` | slices/01 | árvore de rotas (Next.js `app/` ou PHP) |
| `bubble-component` | slices/02 + 05 + 06 + 1 reusable id | `components/<Name>.tsx` |
| `bubble-behavior` | PRD §N + slices/08 + 1 page id | `pages/<page>/<behavior>/` completo |
| `bubble-api-client` | slices/07 + 1 api_id | `lib/clients/<api>.ts` tipado |

Cada skill é fina: **um Python que monta o contexto exato + um prompt curto que enforça o padrão do CLAUDE.md** (thin client, isolamento por behavior, test-first, reusar antes de criar).

## Scripts Python a criar (fase de andaime)

- `gen_schema.py` — slices → SQL + tipos. 100% determinístico.
- `gen_routes.py` — slices/01 → árvore `app/` vazia (page.tsx stub por rota).
- `gen_client_stubs.py` — slices/07 → arquivos de cliente API com assinaturas, sem corpo.
- `audit_coverage.py` — depois que LLM gerar tudo: confere se cada endpoint do slice tem cliente, cada page tem rota, cada reusable tem componente.

## Por que `Next.js + Supabase` em vez de PHP

Recomendação técnica (pode contestar):
- O `.bubble` já chama Supabase REST diretamente. Migrar pra PHP exigiria reescrever todo o data layer.
- A skill `supabase` do seu Claude Code está pronta — encurta a etapa de schema/auth/RLS.
- Next.js permite reusar o thin-client/fat-server do CLAUDE.md sem fricção.
- PHP só faz sentido se o destino for um host tradicional sem Node. Se for este o caso, o pipeline acima troca apenas o passo 4 (templates Twig/Blade no lugar de React).

## Ordem de execução recomendada (etapa 2)

1. **Schema + tipos** (1 dia). Determinístico — basta rodar `gen_schema.py`.
2. **Rotas vazias + clientes stubs** (1 dia). Determinístico.
3. **Auth + Onboarding** (1 dia). Primeiro behavior end-to-end — valida o pipeline inteiro.
4. **CRUD de Clientes** (1 dia). Padrão repetível.
5. **Notas fiscais — listagem + detalhes** (2 dias). UI complexa.
6. **Notas fiscais — emissão NFe → NFCe → NFSe** (3–5 dias). Integração externa.
7. **Motor fiscal (n8n + Serpro)** (3 dias). Maior parte é orquestração no n8n já existente.
8. **Honorários, Abertura de empresa, refinos** (2 dias).

Total estimado: ~2 semanas de execução guiada pelo Claude Code.

## O que aprovar antes de começar

1. ✅ Next.js + Supabase como destino (ou PHP — diga qual).
2. ✅ Pasta de saída: `balu-next/` (irmã de `bubble-to-prd/`)?
3. ✅ Manter o n8n e a Focus NFe como estão, só refatorar o front + Supabase schema?
4. ✅ Posso criar as 5 skills novas dentro de `bubble-to-prd/skills/`?

Quando voltar, responda 1–4 e eu começo pela skill `bubble-schema`.
