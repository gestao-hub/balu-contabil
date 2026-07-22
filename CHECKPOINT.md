# CHECKPOINT — Balu

> Estado vivo do projeto para retomada de contexto. Atualizar ao fim de cada sessão de trabalho.
> **Última atualização:** 2026-07-22

---

## Onde estamos

**Fase:** planejamento do escopo de lançamento concluído → pronto para implementar o **Bloco A**.

O código do app está congelado desde 15/06/2026 (commit `52a0844`). Em 22/07 foi feita a análise cruzada dos documentos de direcionamento (`Direcionamento/`: batimento, comparativo Contabilizei e devolutiva do Michel) contra o código real, e produzidos os documentos abaixo.

## Documentos-guia (ordem de leitura para retomar contexto)

1. `docs/product/PRD-Balu-V2.md` — **escopo de lançamento**: visão, 5 blocos (A–E), enquadramento legal consolidado, dependências externas, critérios de aceite propostos, pontos a realinhar com o Michel.
2. `docs/superpowers/specs/2026-07-22-bloco-a-multitenant-contador-design.md` — spec aprovada do Bloco A.
3. `docs/superpowers/plans/2026-07-22-bloco-a-multitenant-contador.md` — **plano de implementação do Bloco A (21 tasks, próximo passo)**.
4. `docs/investigations/BATIMENTO-PLANEJAMENTO-VERDE.md` — o que está entregue vs. planejado (jun/2026, ainda válido).
5. `Direcionamento/devolutiva-dev-preenchido.html` (fora do repo, em `D:\balu-app-v2\Direcionamento\`) — fonte da verdade das decisões do cliente.

## Sequência dos blocos

**A (multi-tenant contador) → E (hardening/LGPD) → D (produção fiscal) → B (billing Asaas) → C (notificações/WhatsApp/IA)**

| Bloco | Spec | Plano | Implementação |
|---|---|---|---|
| A — multi-tenant, painel contador, white-label, honorários v2 | ✅ aprovada | ✅ escrito (21 tasks) | ⬜ não iniciada |
| E — hardening + LGPD | ⬜ | ⬜ | ⬜ |
| D — produção fiscal (Focus prod, PGDAS-D real, DASN assistida, abertura UI) | ⬜ | ⬜ | ⬜ |
| B — billing Asaas | ⬜ | ⬜ | ⬜ |
| C — notificações, WhatsApp, IA | ⬜ | ⬜ | ⬜ |

## Decisões-chave já tomadas (não rediscutir sem motivo novo)

- Multi-escritório desde o lançamento; 1 escritório = N usuários iguais (papéis = V2).
- Painel do contador é **somente visualização**; garantia no banco (RLS sem políticas de escrita).
- Cadastro de escritório com **aprovação por admin** (validação CRC — DL 9.295/46).
- Co-branding (não substituição total); e-mails de auth continuam Balu.
- Honorários v2: controle manual + recorrência via cron; Asaas pluga depois (campos `asaas_*` prontos).
- Semáforo "irregular": 5 critérios fiscais (LC 123 arts. 3º/18-A/21; Res. CGSN 140/2018 arts. 38 e 109); honorário atrasado é coluna separada.
- Tetos fiscais em tabela `parametros_fiscais`, nunca hard-coded.
- IA nunca calcula/transmite — determinístico decide, IA explica (guard-rail de todos os blocos).
- Reforma Tributária: CBS/IBS **não atinge Simples/MEI em 2026** — sem ação no lançamento.

## Pendências externas (cobrar do Michel — travam D/B/C, não A/E)

- [ ] Validar credenciais SERPRO de produção (ele diz "já tenho"; Trial dava 403)
- [ ] Credenciais Asaas de produção (não existem)
- [ ] Credenciais WhatsApp Business API (ele diz que tem)
- [ ] Contrato Focus produção + certificados A1 dos pilotos + procurações RFB
- [ ] Realinhar: "saldo disponível real" no dashboard · DASN-SIMEI sem transmissão automática (fluxo assistido) · DEFIS no lançamento ou V2 · definição de pronto + nº de pilotos

## Próximo passo imediato

Executar o plano do Bloco A (`docs/superpowers/plans/2026-07-22-bloco-a-multitenant-contador.md`), task por task, em branch `feat/bloco-a-multitenant`. Critério de merge: testes de RLS (Task 20) verdes.

## Convenções da sessão

- Rodar ferramentas a partir de `balu/` (raiz do git). Specs/planos via skills brainstorming → writing-plans.
- Git identity local: Walace <eufacopublicidade@gmail.com>.
- Banco: `docs/reference/db_atual.sql` é a fonte da verdade do schema (a `0001` é idealizada e diverge — ver `docs/investigations/DB-DIVERGENCIA.md`); migrations aplicadas manualmente no SQL Editor.
