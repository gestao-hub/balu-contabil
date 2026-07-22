# Status de Implementação — Balu (2026-07-22)

> Auditoria de todos os PRDs/specs em `docs/product/` contra o código real (`app/src`, `app/supabase/migrations` até 0042). Fonte: 3 auditorias cruzadas independentes. Este documento é a **fonte da verdade de status**; atualizar ao concluir cada item.

## Sumário executivo

- **Blocos A (multi-tenant contador) e E (hardening/LGPD): ✅ completos** e em `main` (migrations 0030–0042).
- **Bloco D (produção fiscal): 🟡 parcial** — tudo roda em homologação/dry-run/consulta; produção travada em credenciais externas.
- **Blocos B (billing Asaas) e C (notificações/WhatsApp/IA): ❌ não iniciados** (só colunas-gancho `asaas_*`).
- **Docs de visão** (`V1-FUNCIONALIDADES`, `V2-FUNCIONALIDADES`, `PRD-Balu`) descrevem muito além do lançamento: IA, WhatsApp, Open Finance, domínio customizado — majoritariamente não construído, e por design (pós-lançamento).
- **A maior parte do que falta em D/B/C está travada em credenciais do Michel**, não em código. Há, porém, trabalho relevante **buildável agora** (motor de obrigações/notificações, gestão de abertura, DASN assistida, DEFIS).

## Matriz de status por área

Legenda: ✅ implementado · 🟡 parcial · ❌ ausente · 🔒 travado em credencial externa

### Produto base (V1)

| Área | Status | Evidência / Lacuna |
|---|---|---|
| Dashboard do empresário (receita mês, próxima obrigação, última nota) | ✅ | `(auth)/page.tsx` + `lib/dashboard/queries.ts` |
| Lista "o que você precisa fazer" | ✅ | `getPendingActions` (guias vencidas/a vencer, notas pendentes). Lacuna: sem pendência de certificado A1 vencendo (a coluna `arquivos_auxiliares.cert_not_after` **existe** — dá pra fazer) |
| Emissão NFe/NFCe/NFSe (Focus) | ✅ | `notas_fiscais/actions.ts`. Env travado em `'hom'` |
| Preview de imposto antes de emitir | ✅ | `lib/fiscal/preview-imposto.ts` |
| Alerta de limite de faturamento | ✅ | `LimiteEmissaoBanner` + `lib/fiscal/limite-emissao.ts` |
| Histórico + export CSV de notas | ✅ | `NotasFiscaisList`, `exportNotasCsvAction`, download `[id]/download` |
| XML + PDF automáticos | ✅ | `[id]/download/route.ts` (Focus legacy + NFSe Nacional S3) |
| Apuração DAS / DAS-MEI (cálculo local) | 🟡 | `lib/fiscal/{apuracao,rbt12,das-mei,anexo-resolver}.ts` + `impostos/novo/ApuracaoWizard`. **Só manual — sem cron mensal**; `lib/clients/n8n.ts` é código morto |
| Geração de guia (DAS boleto/Pix) via SERPRO | ✅🔒 | `lib/clients/serpro.ts` + `gerarDasMei/SimplesAction`. Roda em SERPRO Trial |
| Marcar guia paga | ✅ | `marcarGuiaPagaAction` |
| Clientes (CRUD, dedup, RLS) | ✅ | `clientes/actions.ts` |
| Wizard de abertura de empresa (coleta) | 🟡 | `AberturaWizard.tsx` + `onboarding/abertura/actions.ts`. **Só coleta** — sem submissão a órgão, sem gestão de etapa |
| Onboarding conversacional com IA | ❌ | Não existe LLM no código |
| Explicação da apuração em linguagem simples | ❌ | Não existe |
| Repositório de documentos | ❌ | Sem rota `/documentos` |
| Motor de obrigações proativo (avisos DAS/DASN/cert) | ❌ | Sem tabela de notificações, sem cron, sem sino |

### Blocos de lançamento (PRD-Balu-V2)

| Bloco | Status | Detalhe |
|---|---|---|
| **A** multi-tenant contador | ✅ | 0030–0036; painel/semáforo/drill-down/honorários v2/white-label/convites/admin. Nada faltando vs. spec |
| **E** hardening/LGPD | ✅ | 0037–0042; 6/7 itens sólidos. Webhook Focus = segredo+rate-limit (não HMAC — a Focus não oferece; documentado) |
| **D** produção fiscal | 🟡🔒 | Emissão travada em `hom`; PGDAS-D só dry-run (`indicadorTransmissao:false`); DASN-SIMEI só consulta; **DEFIS inexistente**; abertura só exibe etapa |
| **B** billing Asaas | ❌🔒 | Só colunas `asaas_charge_id`/`asaas_customer_id` em `honorarios`. Sem `assinaturas`/`cobrancas`, sem gate |
| **C** notificações/WhatsApp/IA | ❌🔒 | Zero código |

### Visão futura (V2-FUNCIONALIDADES / PRD-Balu)

| Área | Status |
|---|---|
| IA conversacional (onboarding, sugestão de código de serviço, busca semântica LC116) | ❌ |
| WhatsApp como canal único (bot + escalonamento + OCR de documentos) | ❌ |
| Cobrança/aviso via WhatsApp + Pix Copia-e-Cola | ❌ |
| Conciliação bancária (Open Finance) | ❌ |
| Domínio customizado por escritório | ❌ (Bloco A entregou co-branding, não domínio) |
| SLA configurável do escritório | ❌ |
| Lucro Presumido/Real, eSocial/SPED/EFD-Reinf, folha | ❌ (explicitamente fora do lançamento) |

## Backlog priorizado (o que falta, por importância)

Ver PRD e spec detalhados (mesma pasta `docs/novas specs e prd/`):
- `PRD-Remanescente-Balu.md`
- `2026-07-22-remanescente-design.md`

**P0 — bloqueadores de lançamento**
1. **Produção fiscal — emissão real** (Focus produção) 🔒 *credencial Michel*
2. **Motor de obrigações + notificações** (calendário fiscal, avisos DAS/DASN/cert A1, in-app + e-mail) — **buildável agora**
3. **PGDAS-D transmissão real** (SERPRO produção + procurações) 🔒 *credencial Michel*

**P1 — completar o lançamento**
4. **Billing Asaas** (assinaturas/cobranças + gate) 🔒 *Asaas prod; sandbox buildável*
5. **Gestão de etapas de abertura pela UI** (contador/admin atualiza `processo_etapa`) — **buildável agora**
6. **DASN-SIMEI fluxo assistido + DEFIS** — **buildável agora**

**P2 — diferencial pós-lançamento**
7. Notificações por WhatsApp 🔒 *WhatsApp Business API*
8. IA (onboarding leigo, explicações, sugestão de código de serviço) 🔒 *chave LLM*
9. Repositório de documentos · conciliação bancária

**P3 — visão futura (V2)**
10. Domínio customizado · busca semântica LC116 · SLA · Lucro Presumido · eSocial/SPED

## Dependências externas que travam P0/P1 (cobrar do Michel)

- Credenciais SERPRO de **produção** (Trial dava 403) + procurações eletrônicas RFB por cliente.
- Contrato Focus **produção** + certificados A1 dos pilotos.
- Credenciais **Asaas** de produção.
- Credenciais **WhatsApp Business API** (Bloco C).
- Definições de negócio: nº de pilotos, "definição de pronto", DEFIS no lançamento ou V2, DASN sem transmissão automática (fluxo assistido).
