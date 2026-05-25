---
name: bubble-component
description: Converte um reusable do Bubble (FloatingGroup/Popup/Group em element_definitions) num componente React + Tailwind para Next.js 15 App Router. Use quando o usuário pedir "gerar componente <X> do Bubble", "converter reusable", "criar componente a partir do .bubble". Atua sobre 1 reusable por chamada.
---

# Skill: bubble-component

## Quando usar
- Existe um `.bubble` na raiz do projeto.
- O scaffold `balu-next/` já existe (criado por `gen_schema.py` + `gen_routes.py` + `gen_clients.py`).
- Usuário quer gerar 1 componente React específico (ou em lote — chame a skill N vezes).

## Algoritmo

### Passo 1 — Inventário (uma vez)
```bash
python3 bubble-to-prd/skills/inventory_reusables.py excluviapainel.bubble
```
Mostra todos os reusables com nome inferido e complexidade.

### Passo 2 — Preparar o pacote do componente
```bash
python3 bubble-to-prd/skills/prep_component.py excluviapainel.bubble <REUSABLE_ID> \
    --out bubble-to-prd/skills/bubble-component/_packs
```
Gera `_packs/<REUSABLE_ID>/{tree,states,workflows,briefing}.{json,md}`.

### Passo 3 — Gerar React via LLM
Carregue como contexto, nesta ordem:
1. `PROMPT.md` (regras + estrutura de saída)
2. `_packs/<id>/briefing.md` (resumo)
3. `_packs/<id>/tree.json` (hierarquia visual)
4. `_packs/<id>/states.json` (reatividade)
5. `_packs/<id>/workflows.json` (eventos → ações)
6. `bubble-to-prd/slices/06_design_tokens.json` (cores/fontes)
7. `balu-next/src/types/enums.ts` (se workflows usam option_sets)
8. `balu-next/src/lib/clients/_endpoints.ts` (se workflows chamam APIs)

Escreva em `balu-next/src/components/<PascalName>.tsx`.

### Passo 4 — Validar
```bash
cd balu-next && npx tsc --noEmit
```
Tem que compilar limpo. Se faltar import, ajustar.

## Nomenclatura — automática a partir do export

**IDs do Bubble não são portáveis** (mudam a cada export e entre apps). Use `inventory_reusables.py` para listar todos os reusables com seu `bubble_name` original e `react_name` derivado:

```bash
python3 inventory_reusables.py <app.bubble>
```

A skill resolve o nome em 3 camadas:
1. **`element_definitions[id].name`** ← nome que o dev definiu no editor Bubble (source of truth, sempre presente)
2. **`properties.wf_folder_list`** ← labels de pastas de workflow (revelam intent: "Viacep", "Trigger_Verify_client")
3. **`properties.element_type`** ← FloatingGroup/Popup/Group (classifica como overlay/modal/inline)

Se `bubble_name` for críptico (ex: `PU_padrao`, `Menu(i)`), o LLM escolhe um equivalente em inglês legível e registra o nome original num comentário de cabeçalho para rastreabilidade.

## Limites

- Workflows que chamam `apiconnector2-<api_id>.<call_id>` precisam ser mapeados via `_endpoints.ts`. Se o mapeamento for ambíguo, deixe um TODO no componente e mova lógica para o pai (server action).
- States do Bubble viram `useState` simples; condições complexas devem virar derived values.
- Reusables com 0 elementos (`bTJfI`, `bTIHH0`) são hooks/utilitários — não geram `.tsx`, geram `.ts` em `src/hooks/`.

## Princípios (do CLAUDE.md global)

- Thin client: zero chamadas REST direto da UI. Use server actions ou route handlers.
- Composição: 1 componente por arquivo. Sub-elementos virais (>3 usos) viram componentes próprios.
- Tailwind: usar tokens de `tailwind.config.ts` (`brand-teal`, `primary`, `destructive`); evitar arbitrary values quando token existir.
