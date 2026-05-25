# balu-next

Reconstrução do app Balu (Bubble.io → Next.js 15 + Supabase + Tailwind).

Todo o esqueleto deste repositório foi **gerado automaticamente** a partir de `../excluviapainel.bubble` pelas skills em `../bubble-to-prd/skills/`.

## Status atual

| Camada | Status | Origem |
|---|---|---|
| Schema Postgres + RLS | ✅ gerado | `gen_schema.py` |
| Enums TS (option_sets) | ✅ gerado | `gen_schema.py` |
| Rotas Next.js (stubs) | ✅ gerado | `gen_routes.py` |
| Clientes API tipados | ✅ gerado | `gen_clients.py` |
| Scaffold (deps, TS, Tailwind) | ✅ manual | — |
| Componentes (reusables) | ⏳ pendente — LLM | skill `bubble-component` |
| Behaviors por page | ⏳ pendente — LLM | skill `bubble-behavior` |
| Testes E2E | ⏳ pendente | qa-playwright |

## Bootstrap

```bash
cp .env.example .env.local   # preencher chaves
npm install
npm run gen:all              # regenera schema/rotas/clientes
npm run dev
```

Aplicar schema no Supabase:
```bash
# usar Supabase CLI ou colar supabase/migrations/0001_init.sql no SQL Editor
```

## Estrutura

```
src/
├── app/
│   ├── (public)/login, cadastro, reset_pw   ← rotas sem auth
│   └── (auth)/                              ← layout guard + Menu
│       ├── page.tsx                         ← /
│       ├── clientes, configuracoes
│       ├── notas_fiscais/, .../[id], .../emissao
│       └── impostos/, .../novo
├── lib/
│   ├── supabase/{server,browser}.ts         ← @supabase/ssr
│   └── clients/{focus-nfe,serpro,n8n}.ts    ← APIs externas (server-only)
├── types/
│   ├── enums.ts                             ← 26 option_sets do Bubble
│   ├── zod.ts                               ← schemas de validação
│   └── database.ts                          ← placeholder p/ supabase gen
└── supabase/migrations/0001_init.sql        ← 12 tabelas + RLS
```

## Princípios (do CLAUDE.md global)

- Thin client, fat server — nenhum secret no front; Focus/Serpro só via routes server.
- 1 behavior por pasta dentro de `src/app/(auth)/<page>/<behavior>/`.
- Reusar antes de criar. Test-first.
- Spec é fonte da verdade: ver `../PRD-Balu.md` antes de tomar qualquer decisão de design.

## Próximas tasks

1. Instalar deps e validar `npm run typecheck`.
2. Aplicar migração no Supabase de produção.
3. Implementar behaviors na ordem do `../STAGE-2-PLAN.md` §"Ordem de execução".
