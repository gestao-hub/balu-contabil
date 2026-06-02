# Reorganização de arquivos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renomear `balu-next/` → `app/` e consolidar toda a documentação numa única árvore `docs/` na raiz, deixando o repositório limpo para o deploy de produção.

**Architecture:** Operação mecânica de reorganização em monorepo. O git é a raiz `balu/`; o app deployável vira `app/`; toda documentação narrativa, specs, plans, referências e assets migram para `docs/` com subpastas por tipo. Caminhos dentro do app são relativos, então o rename quase não toca código. Moves feitos com `mv` + `git add -A` (o git detecta renames por similaridade e preserva histórico, cobrindo tracked e untracked sem casos especiais).

**Tech Stack:** git, bash/sed, Next.js (app), npm.

**Referência:** spec em `docs/superpowers/specs/2026-06-02-reorganizacao-arquivos-design.md`.

---

## Notas de execução (ler antes de começar)

- **Rodar todos os comandos a partir da raiz** `/home/allan/Projetos/claude/balu`.
- **NÃO** rodar `npm run build` com `next dev` ativo (corrompe o `.next` compartilhado).
- A árvore `docs/n8n/` contém segredos (.pfx + senha.json) e é gitignored — **nunca tocar**.
- Os board.csv que migrarem para `docs/superpowers/plans/` passam a casar com o
  gitignore root (`docs/superpowers/plans/*-board.csv`) e saem do versionamento.
  Isso é esperado/desejado — são exports voláteis do kanban.

---

### Task 1: Renomear `balu-next/` → `app/`

**Files:**
- Rename: `balu-next/` → `app/` (diretório inteiro)

- [ ] **Step 1: Renomear o diretório**

```bash
cd /home/allan/Projetos/claude/balu
mv balu-next app
```

- [ ] **Step 2: Stage do rename**

```bash
git add -A
```

- [ ] **Step 3: Verificar que o git detectou renames (não delete+add)**

Run: `git status --short | grep -E "^R" | head`
Expected: linhas começando com `R` (renamed) para arquivos tracked; ex.:
`R  balu-next/package.json -> app/package.json`. A pasta `app/` existe e
`balu-next/` não.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: renomeia balu-next/ -> app/"
```

---

### Task 2: Criar subpastas de docs e mover docs narrativos da raiz

**Files:**
- Create: `docs/product/`, `docs/planning/`, `docs/investigations/`, `docs/reference/`, `docs/assets/`
- Move (raiz → docs/product/): `PRD-Balu.md`, `V1-FUNCIONALIDADES.md`, `V2-FUNCIONALIDADES.md`
- Move (raiz → docs/planning/): `STATUS-IMPLEMENTACAO.md`, `PLANO-4-DIAS.md`, `STAGE-2-PLAN.md`
- Move (raiz → docs/investigations/): `SERPRO-INVESTIGACAO.md`, `ANALISE-CONTABILIZEI.md`, `DB-DIVERGENCIA.md`

- [ ] **Step 1: Criar as subpastas**

```bash
cd /home/allan/Projetos/claude/balu
mkdir -p docs/product docs/planning docs/investigations docs/reference docs/assets
```

- [ ] **Step 2: Mover os docs narrativos**

```bash
mv PRD-Balu.md V1-FUNCIONALIDADES.md V2-FUNCIONALIDADES.md docs/product/
mv STATUS-IMPLEMENTACAO.md PLANO-4-DIAS.md STAGE-2-PLAN.md docs/planning/
mv SERPRO-INVESTIGACAO.md ANALISE-CONTABILIZEI.md DB-DIVERGENCIA.md docs/investigations/
```

- [ ] **Step 3: Verificar que a raiz só tem README.md de .md**

Run: `ls *.md`
Expected: apenas `README.md`.

- [ ] **Step 4: Stage e commit**

```bash
git add -A
git commit -m "docs: move docs narrativos da raiz para docs/{product,planning,investigations}"
```

---

### Task 3: Mover referências e assets

**Files:**
- Move (→ docs/reference/): `app/db_atual.sql`, `app/docs/rls-test-results-2026-05-29.md`, `app/docs/saneamento-results-2026-05-29.md`
- Move (→ docs/assets/): `conta-perfil.png`, `honorarios-dialog.png`, `impostos-dashboard.png`, `planejamento-balu.pdf`

- [ ] **Step 1: Mover referências (snapshot DB + resultados de teste)**

```bash
cd /home/allan/Projetos/claude/balu
mv app/db_atual.sql docs/reference/
mv app/docs/rls-test-results-2026-05-29.md docs/reference/
mv app/docs/saneamento-results-2026-05-29.md docs/reference/
```

- [ ] **Step 2: Mover assets (imagens + PDF de planejamento)**

```bash
mv conta-perfil.png honorarios-dialog.png impostos-dashboard.png planejamento-balu.pdf docs/assets/
```

Nota: os 3 PNGs eram gitignored na raiz (`/*.png`); em `docs/assets/` passam a
ser versionáveis — é o comportamento desejado (viram documentação rastreável).

- [ ] **Step 3: Verificar**

Run: `ls docs/reference/ docs/assets/`
Expected: reference/ com `db_atual.sql`, `rls-test-results-2026-05-29.md`,
`saneamento-results-2026-05-29.md`; assets/ com os 4 arquivos (3 png + 1 pdf).

- [ ] **Step 4: Stage e commit**

```bash
git add -A
git commit -m "docs: move db_atual.sql, resultados de teste e assets para docs/{reference,assets}"
```

---

### Task 4: Merge das árvores superpowers e limpeza de `app/docs`

**Files:**
- Move: `app/docs/superpowers/specs/*` → `docs/superpowers/specs/`
- Move: `app/docs/superpowers/plans/*` → `docs/superpowers/plans/`
- Delete: `app/docs/` (esvaziada)

- [ ] **Step 1: Mover specs e plans recentes para a árvore canônica**

```bash
cd /home/allan/Projetos/claude/balu
mv app/docs/superpowers/specs/* docs/superpowers/specs/
mv app/docs/superpowers/plans/* docs/superpowers/plans/
```

Nota: sem colisão de nomes — os arquivos de `app/docs` são de 01–02/jun e os da
raiz são de 27–31/mai.

- [ ] **Step 2: Remover a árvore docs/ vazia dentro de app/**

```bash
rm -rf app/docs
```

- [ ] **Step 3: Verificar que não sobrou doc dentro do app**

Run: `find app/docs 2>/dev/null; echo "exit=$?"`
Expected: sem saída de arquivos e `app/docs` inexistente (ls falharia).

Run: `ls docs/superpowers/specs/*.md | wc -l && ls docs/superpowers/plans/ | wc -l`
Expected: specs/ ganhou os **3** designs de jun (onboarding, conta-page,
municipios-nfse-sync); plans/ ganhou os **7** itens de jun. Confirme que os
nomes de jun aparecem: `ls docs/superpowers/specs/2026-06-* docs/superpowers/plans/2026-06-*`.

- [ ] **Step 4: Stage e commit**

```bash
git add -A
git commit -m "docs: merge das specs/plans de app/docs na arvore canonica docs/superpowers"
```

---

### Task 5: Atualizar referências funcionais (.gitignore + nome do pacote)

**Files:**
- Modify: `.gitignore` (raiz)
- Modify: `app/package.json`, `app/package-lock.json`

- [ ] **Step 1: Reescrever paths `balu-next/` → `app/` no .gitignore e anexar novas regras**

```bash
cd /home/allan/Projetos/claude/balu
sed -i 's#balu-next/#app/#g' .gitignore
printf '\n# ── App: saída de testes (screenshots) + kanban stray ──\napp/screenshots/\napp/.kanban/\n' >> .gitignore
```

- [ ] **Step 2: Verificar o .gitignore**

Run: `grep -nE "app/|balu-next" .gitignore`
Expected: várias linhas `app/...` (node_modules, .next, .env, test-results,
screenshots, .kanban etc.) e **nenhuma** ocorrência de `balu-next`.

- [ ] **Step 3: Renomear o pacote npm `balu-next` → `balu-app`**

```bash
sed -i 's/"name": "balu-next"/"name": "balu-app"/' app/package.json
sed -i '0,/"name": "balu-next"/{s/"name": "balu-next"/"name": "balu-app"/}' app/package-lock.json
sed -i 's#"node_modules/balu-next"#"node_modules/balu-app"#g; s/"balu-next": {/"balu-app": {/g' app/package-lock.json
```

Nota: o package-lock tem o nome em 2 lugares (campo `name` raiz e o
self-reference em `packages`). Os 3 sed cobrem ambos sem quebrar o JSON.

- [ ] **Step 4: Verificar que não sobrou `balu-next` em package.json/lock**

Run: `grep -c "balu-next" app/package.json app/package-lock.json`
Expected: `app/package.json:0` e `app/package-lock.json:0`.

- [ ] **Step 5: Validar o JSON do lock (não corrompeu)**

Run: `cd app && node -e "JSON.parse(require('fs').readFileSync('package-lock.json'))" && echo OK; cd ..`
Expected: `OK`.

- [ ] **Step 6: Stage e commit**

```bash
git add -A
git commit -m "chore: ajusta .gitignore (balu-next->app) e renomeia pacote npm para balu-app"
```

---

### Task 6: Find-replace cosmético `balu-next` → `app` nos .md versionados

**Files:**
- Modify: todos os `*.md` versionados que citam `balu-next`, **exceto** os 2 docs deste próprio trabalho de reorg.

- [ ] **Step 1: Listar os .md que serão alterados (conferência prévia)**

```bash
cd /home/allan/Projetos/claude/balu
git grep -l "balu-next" -- '*.md' \
  | grep -v 'reorganizacao-arquivos' | tee /tmp/md-to-fix.txt
```

Expected: lista de specs/plans/docs históricos (sem os arquivos
`*reorganizacao-arquivos*`, que descrevem o rename e devem manter "balu-next").

- [ ] **Step 2: Aplicar a substituição literal `balu-next` → `app`**

```bash
xargs sed -i 's/balu-next/app/g' < /tmp/md-to-fix.txt
```

Nota: cobre tanto paths (`balu-next/src` → `app/src`) quanto caminhos absolutos
embutidos em planos (`.../balu/balu-next` → `.../balu/app`).

- [ ] **Step 3: Verificar que só sobrou `balu-next` nos docs de reorg**

Run: `git grep -l "balu-next" -- '*.md'`
Expected: somente
`docs/superpowers/specs/2026-06-02-reorganizacao-arquivos-design.md` e
`docs/superpowers/plans/2026-06-02-reorganizacao-arquivos.md`.

- [ ] **Step 4: Stage e commit**

```bash
git add -A
git commit -m "docs: atualiza referencias balu-next -> app nos specs/plans/docs"
```

---

### Task 7: Limpeza de estado volátil (kanban stray)

**Files:**
- Delete: `app/.kanban/` (board duplicado; o canônico é `.kanban/` na raiz)

- [ ] **Step 1: Remover o kanban stray do app**

```bash
cd /home/allan/Projetos/claude/balu
rm -rf app/.kanban
```

- [ ] **Step 2: Verificar**

Run: `ls -d app/.kanban 2>/dev/null; ls -d .kanban`
Expected: `app/.kanban` inexistente; `.kanban` (raiz) presente.

Nenhum commit necessário — `app/.kanban/` é untracked/gitignored.

---

### Task 8: Verificação final do app (typecheck + grep + status)

**Files:** nenhum (verificação)

- [ ] **Step 1: Typecheck do app**

```bash
cd /home/allan/Projetos/claude/balu/app
npm run typecheck 2>&1 | tail -5
```

Expected: `Found 0 errors` (ou ausência de erros). Volte para a raiz depois:
`cd ..`.

- [ ] **Step 2: Conferir que não há referência funcional remanescente a balu-next**

```bash
cd /home/allan/Projetos/claude/balu
git grep -n "balu-next" -- ':!*reorganizacao-arquivos*' | grep -v package-lock || echo "limpo"
```

Expected: `limpo` (ou só ocorrências aceitáveis em prosa histórica não-path, se
houver — avaliar caso a caso).

- [ ] **Step 3: Conferir a estrutura final**

Run: `ls && echo "---DOCS---" && ls docs && echo "---APP---" && ls app | head`
Expected: raiz com `app/`, `docs/`, `README.md`, `bubble-to-prd/`, `branding/`
(sem .md soltos além de README, sem PNG/PDF soltos). `docs/` com product,
planning, investigations, reference, assets, superpowers, n8n. `app/` com src,
supabase, tests, etc.

- [ ] **Step 4: (Opcional, recomendado antes do deploy) Build de produção**

⚠️ Garanta que **não** há `next dev` rodando antes.

```bash
cd /home/allan/Projetos/claude/balu/app && npm run build 2>&1 | tail -15; cd ..
```

Expected: build conclui sem erro (`✓ Compiled successfully` / rotas listadas).

---

### Task 9: Atualizar memória e registrar ação manual da Vercel

**Files:**
- Modify: memória `balu-app-em-balu-next.md` + índice `MEMORY.md`
  (em `/home/allan/.claude/projects/-home-allan-Projetos-claude-balu/memory/`)

- [ ] **Step 1: Atualizar o conteúdo da memória "App vive em balu-next/"**

Reescrever o corpo do arquivo `balu-app-em-balu-next.md` para refletir que o app
agora vive em `app/` (era `balu-next/`), e que a documentação foi consolidada em
`docs/` na raiz. Atualizar a descrição no frontmatter e a linha correspondente em
`MEMORY.md`. Considerar renomear o arquivo para `balu-app-em-app.md` (atualizando
o link em MEMORY.md).

- [ ] **Step 2: Lembrete de ação manual (NÃO automatizável)**

Avisar o usuário: no **dashboard da Vercel**, mudar **Settings → Build & Output →
Root Directory** de `balu-next` para `app`. Sem isso, o deploy de produção aponta
para a pasta antiga e quebra.

---

## Notas finais

- Após a Task 8, o repositório está reorganizado e o app builda. O deploy em si
  (env vars de produção, Supabase prod, domínio, rotação da chave vazada) é a
  **próxima etapa**, fora do escopo deste plano.
- A convenção anti-divergência (rodar Claude sempre da raiz) deve ser seguida
  daqui pra frente para que novas specs/plans caiam em `docs/` e não recriem
  uma árvore dentro de `app/`.
