# Batimento — Planejamento (itens em verde) × Entregue

> **Objetivo:** conferir, item a item, o que o `planejamento-balu.pdf` marcou em **verde (✅)** contra o que de fato está implementado no app (`app/`, jun/2026).
> **Por que só o verde:** no PDF, ✅ verde = comprometido/no escopo; 🟡 amarelo = ideia/parcial. O pedido foi bater **o verde**. Os itens amarelos do plano ficam fora deste batimento (listados ao final como contexto).
> **Base:** lado **Plano** = marcação do PDF; lado **Entregue** = leitura do código real (não do `STATUS-IMPLEMENTACAO.md`, que está defasado nas §1/§2).
> **Relacionado:** [`COMPARATIVO-BALU-CONTABILIZEI.md`](./COMPARATIVO-BALU-CONTABILIZEI.md) · [`../planning/STATUS-IMPLEMENTACAO.md`](../planning/STATUS-IMPLEMENTACAO.md)
>
> **Legenda (coluna Entregue):** ✅ entregue · 🟡 parcial (base existe, falta orquestração/automação) · 🔴 não entregue

## §1. Onboarding Guiado com IA Educacional

| Item (verde no plano) | Entregue | Estado real / evidência |
|---|:---:|---|
| Fluxo conversacional ("O que você faz?", "Já tem CNPJ?", "Emite nota?") | 🔴 | Existe `/onboarding` com **seleção por cards** ("já tenho empresa" / "quero abrir") + formulários tradicionais — **não é conversacional e não há IA/LLM** nenhuma no fluxo |
| Geração automática: Perfil empresa, CNAE sugerido, Regime tributário | ✅ | Autofill via busca de CNPJ na Focus: razão social, endereço, **CNAE** e **regime** (`regimeFromOptante`) pré-preenchidos; IBGE resolvido por CEP (`CreateCompanyDialog`) |

## §2. Abertura de Empresa Digital

| Item (verde no plano) | Entregue | Estado real / evidência |
|---|:---:|---|
| Abertura 100% online (MEI + ME sem sócio) | 🟡 | `AberturaWizard` de 5 etapas (~49 campos) + tabela `abertura_empresas` entregues. Mas é **coleta de dados**; **não há integração RedeSim/Receita/Junta** — abertura não é de fato "automática" |
| Checklist automático de documentos | 🟡 | Upload de 8 documentos funciona; **falta** checklist interativo, validação de tipo/tamanho e explicações |
| Geração/envio: Contrato social, solicitações Receita/Junta/Prefeitura | 🔴 | **Não gera contrato social** (objeto social é texto livre); envio aos órgãos é **manual**, sem integração |
| Status em tempo real | 🟡 | Timeline visual existe (`processo_etapa`, 8 estados) mas o status é **atualizado manualmente por admin no banco** — sem realtime/polling |

## §3. Emissão de Notas Fiscais Simplificada

| Item (verde no plano) | Entregue | Estado real / evidência |
|---|:---:|---|
| Emissor NFS-e integrado (ou via proxy) | ✅ | Integração completa via Focus (`emitirNfse` → webhook → status). Ressalva: em produção MVP **emite só em homologação** por design |
| Histórico simples e exportável | ✅ | Listagem com 4 filtros + paginação + **export CSV** (BOM UTF-8). Ressalva: só CSV (sem Excel/PDF) |
| Preview do imposto ANTES de emitir | ✅ | Estimativa de DAS/Simples ao vivo no form de emissão — diferencial |
| Alerta se o cliente estiver próximo do limite de faturamento | ✅ | `LimiteEmissaoBanner` com barra e cores (MEI R$81k / Simples R$4,8M / Normal sem teto) |
| XML + PDF gerados automaticamente | ✅ | Download de XML e PDF na página de detalhe; gerados pelo callback Focus (URL S3 / endpoints legacy) |

## §4. Apuração Automática de Impostos

| Item (verde no plano) | Entregue | Estado real / evidência |
|---|:---:|---|
| Cálculo automático DAS mensal e DAS-MEI | ✅ | MEI automático; Simples gera DAS **após PGDAS-D confirmada** (proteção válida). Motor próprio testado |
| Geração da guia | ✅ | PDF (base64) + linha digitável + código de barras em `guias_fiscais`. Ressalva: em produção depende de habilitação SERPRO (403 900908 no Trial) |
| Explicação em português simples | 🔴 | Painel de impostos é **100% técnico** (valores, datas, badges); **não há copy educacional** explicando DAS/alíquota/anexo/Fator R |

## §7. Gestão de Obrigações Básicas

| Item (verde no plano) | Entregue | Estado real / evidência |
|---|:---:|---|
| Entrega automática DASN-SIMEI e obrigações Simples básicas | 🟡 | **Consulta** DASN-SIMEI (read-only) e fila de obrigações existem; **transmissão real está bloqueada** — DASN-SIMEI sem serviço na SERPRO e PGDAS-D só em dry-run (Fase 2 pendente) |
| Alertas automáticos | 🟡 | Fila visual "Precisa de atenção" (vencida/a_pagar/a_declarar) entregue na UI; **falta o disparo automático** (sem tabela `notifications`, sem e-mail/WhatsApp/cron) |
| Zero ação manual do cliente | 🔴 | Não atingido — transmissão de declaração é manual/bloqueada; é princípio, não feature pronta |

## §8. Área White-Label do Contador

| Item (verde no plano) | Entregue | Estado real / evidência |
|---|:---:|---|
| Logo do escritório | 🔴 | Não existe tabela `contabilidades` nem branding |
| Nome da contabilidade | 🔴 | Idem — sem branding white-label |
| WhatsApp do escritório | 🔴 | Não existe (o `whatsapp_provedor` no schema é do provedor de NFS-e, não do escritório) |
| SLA configurável | 🔴 | Não existe |
| Painel com: quantos clientes, quem está irregular, quem não pagou | 🔴 | Não existe rota `/contador` nem view agregada. Há só base parcial: roles `Empresa`/`Contador` (`role_types`) + página `/honorarios` (lista de honorários por cliente) — **não** é painel de status fiscal |

> §5 (Painel Leigo) e §6 (WhatsApp como Canal Único) **não tinham itens verdes** no plano — ficam fora deste batimento. Obs.: o dashboard do empresário (§5) está, na prática, entregue, mas o plano não o marcou em verde.

## Placar do verde

22 itens marcados em verde no plano:

| Resultado | Qtde | % |
|---|:---:|:---:|
| ✅ Entregue | 8 | 36% |
| 🟡 Parcial | 5 | 23% |
| 🔴 Não entregue | 9 | 41% |

- **Entregue (8):** geração automática de perfil/CNAE/regime · emissor NFS-e · histórico exportável (CSV) · preview de imposto · alerta de limite · XML+PDF · cálculo DAS/DAS-MEI · geração da guia.
- **Parcial (5):** abertura online (wizard sem integração com órgãos) · checklist de docs · status em tempo real · entrega DASN/Simples (consulta sim, transmissão não) · alertas automáticos (fila visual sem disparo).
- **Não entregue (9):** onboarding conversacional · contrato social + envio aos órgãos · explicação em pt simples · zero ação manual · e os 5 itens da **Área White-Label do Contador**.

## Leitura rápida

- **O núcleo fiscal do empresário cumpre o verde:** emissão (NFS-e/NF-e/NFC-e), histórico exportável, preview de imposto, alerta de limite, cálculo e guia de DAS estão entregues — exatamente onde o plano apostou. As ressalvas são externas (emissão só homologação, SERPRO não habilitado no Trial), não de código.
- **Os 41% não entregues se concentram em três frentes:** (1) **Área White-Label do Contador** (§8) — quase tudo verde no plano e **nada feito**, é o maior bloco em aberto; (2) **Abertura de empresa** (§2) — o wizard existe, mas a parte que o plano vendeu como verde (contrato social, envio aos órgãos, status em tempo real, "100% online") depende de integrações inexistentes; (3) as promessas de **IA/educacional** (onboarding conversacional, explicação em português simples) — marcadas verdes, porém sem nenhuma camada de IA no código.
- **Risco de leitura do plano:** vários itens verdes pressupõem automação/integração (RedeSim, transmissão SERPRO real, notificações, multi-tenant do contador) que hoje é manual ou inexistente. O verde do PDF mede *intenção de escopo*, não entrega — daí o gap de ~40%.

---

### Anexo — itens amarelos do plano (fora do batimento, contexto)

Para registro, o que o PDF deixou em 🟡 (não cobrado aqui): IA traduz em linguagem leiga · IA escolhe serviço/código e evita erro de imposto · templates de serviço · busca Google-like de notas · aviso/pagamento/confirmação de imposto via WhatsApp (PIX copia-e-cola, conciliação bancária) · histórico de guias pagas · todo o bloco **§6 WhatsApp como Canal Único** · domínio personalizado (§8). Vários se cruzam com gaps já mapeados no [`COMPARATIVO-BALU-CONTABILIZEI.md`](./COMPARATIVO-BALU-CONTABILIZEI.md).
