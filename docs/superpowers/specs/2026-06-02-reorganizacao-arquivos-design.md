# Reorganização de arquivos — preparo para deploy em produção

**Data:** 2026-06-02
**Status:** Aprovado (design) — aguardando plano de implementação

## Objetivo

Organizar a estrutura do repositório como pré-requisito limpo para o deploy em
produção. Duas frentes:

1. **Renomear** `balu-next/` → `app/` (a pasta do app deployável).
2. **Consolidar toda a documentação** numa única árvore `docs/` na raiz,
   eliminando a divergência entre as duas árvores `docs/superpowers/` que hoje
   existem (raiz + `balu-next/`).

O deploy de produção em si (Vercel, Supabase prod, env vars, domínio) é uma
**etapa seguinte**, fora do escopo deste documento.

## Causa raiz da bagunça

Os skills de superpowers (brainstorming/writing-plans) gravam em
`docs/superpowers/` **relativo ao diretório onde o Claude roda**. Sessões
rodadas da raiz caíram em `docs/superpowers/` (trabalho de 27–31/mai); sessões
rodadas de dentro de `balu-next/` caíram em `balu-next/docs/superpowers/`
(trabalho de 01–02/jun). Resultado: duas árvores `specs/` + `plans/` paralelas.

**Convenção adotada para não divergir de novo:** sempre iniciar o Claude a
partir da **raiz do repositório** (`balu/`), nunca de dentro de `app/`. Assim
toda documentação nova cai em `docs/` na raiz.

## Estrutura-alvo

```
balu/                         (raiz do git — inalterada)
├── README.md                 landing do repo (fica)
├── app/                       ← era balu-next/ (app Next.js deployável)
│   ├── src/
│   ├── supabase/migrations/   infra de DB (FICA no app — não é doc)
│   ├── tests/                 testes do app (FICA no app)
│   ├── screenshots/           saída de teste (gitignored)
│   ├── test-results/          artefato volátil (gitignored)
│   └── ...                    (package.json, next.config.ts, etc.)
├── docs/
│   ├── product/               PRD-Balu, V1-FUNCIONALIDADES, V2-FUNCIONALIDADES
│   ├── planning/              STATUS-IMPLEMENTACAO, PLANO-4-DIAS, STAGE-2-PLAN
│   ├── investigations/        SERPRO-INVESTIGACAO, ANALISE-CONTABILIZEI, DB-DIVERGENCIA
│   ├── reference/             db_atual.sql, rls-test-results, saneamento-results
│   ├── assets/                conta-perfil.png, honorarios-dialog.png,
│   │                          impostos-dashboard.png, planejamento-balu.pdf
│   ├── superpowers/
│   │   ├── specs/             ← MERGE das duas árvores (raiz + balu-next)
│   │   └── plans/             ← MERGE das duas árvores
│   └── n8n/                   ⚠️ FICA como está (gitignored — .pfx + senha.json)
├── bubble-to-prd/             (ferramenta — inalterada)
├── branding/                  (assets de marca — inalterada)
└── superpowers-kanban/        (clone de referência, gitignored — inalterada)
```

## Decisões

| Tema | Decisão |
|------|---------|
| Estrutura do repo | Monorepo, git na raiz. App em `app/`, docs em `docs/`. |
| Pasta de docs | Única árvore `docs/` na raiz, com subpastas por tipo. |
| Anti-divergência | Convenção: rodar Claude sempre da raiz. |
| `supabase/`, `tests/` | Ficam em `app/` — são infra/testes, não docs. |
| `db_atual.sql` | Vai para `docs/reference/`. |
| Specs/plans históricos | Find-replace em massa `balu-next/` → `app/` em todos os `.md` versionados. |
| Nome do pacote npm | `balu-next` → `balu-app` (package.json + package-lock.json). |
| README.md raiz | Fica na raiz (landing do repo). |

## Plano de execução (alto nível)

1. **Rename do app:** `git mv balu-next app` (preserva histórico).
2. **Criar subpastas** `docs/{product,planning,investigations,reference,assets}`.
3. **Mover docs narrativos da raiz** (`git mv`):
   - product/ ← PRD-Balu.md, V1-FUNCIONALIDADES.md, V2-FUNCIONALIDADES.md
   - planning/ ← STATUS-IMPLEMENTACAO.md, PLANO-4-DIAS.md, STAGE-2-PLAN.md
   - investigations/ ← SERPRO-INVESTIGACAO.md, ANALISE-CONTABILIZEI.md, DB-DIVERGENCIA.md
4. **Mover reference/assets:**
   - reference/ ← app/db_atual.sql, app/docs/rls-test-results-*.md, app/docs/saneamento-results-*.md
   - assets/ ← conta-perfil.png, honorarios-dialog.png, impostos-dashboard.png, planejamento-balu.pdf
5. **Merge das árvores superpowers:** mover `app/docs/superpowers/{specs,plans}/*`
   para `docs/superpowers/{specs,plans}/` (sem colisão de nomes — datas distintas).
   Remover `app/docs/` esvaziada.
6. **Referências funcionais:**
   - `.gitignore` da raiz: reescrever todas as entradas `balu-next/` → `app/`;
     adicionar `app/screenshots/` e `app/.kanban/`.
   - `package.json` + `package-lock.json`: `"name": "balu-next"` → `"balu-app"`.
7. **Referências cosméticas:** find-replace em massa `balu-next/` → `app/` nos
   `.md` versionados (specs/plans/docs). Caminhos absolutos em board.json são
   gitignored e voláteis — ignorados.
8. **Limpeza de volátil:** remover `app/.kanban/` (kanban stray; o canônico é o
   `.kanban/` da raiz).
9. **Memória:** atualizar a memória "App vive em balu-next/" → `app/`.

## Verificação

- `npm run typecheck` em `app/` → `Found 0 errors`.
- `npm run build` em `app/` → build OK (rodar SEM `next dev` ativo — corrompe `.next`).
- `git grep -n "balu-next"` em arquivos versionados → sem matches funcionais
  (só restos aceitáveis em histórico, se houver).
- `git status` coerente com renames (history preservado via `git mv`).

## Fora do escopo (etapa seguinte)

- Configurar **Root Directory = `app`** no dashboard da Vercel (ação manual do
  usuário — sem isso o deploy quebra).
- Configurar env vars de produção, Supabase prod, domínio, rotação da chave
  vazada (ver memória `balu-env-service-role-is-anon`).

## Riscos

- **Vercel Root Directory:** se não ajustado no dashboard, o deploy aponta pra
  pasta errada. Mitigação: documentado como ação manual obrigatória.
- **Find-replace em massa:** reescreve specs históricos. Risco baixo — substituição
  é literal `balu-next/` (path), não toca prosa não-relacionada.
- **Caminhos absolutos em planos antigos** (`cd .../balu-next && ...`): cosméticos,
  em arquivos de histórico; serão cobertos pelo find-replace.
