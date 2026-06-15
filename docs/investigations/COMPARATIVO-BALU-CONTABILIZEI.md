# Comparativo Balu × Contabilizei

> **Objetivo:** diff lado a lado das soluções do Balu vs. Contabilizei, por área.
> **Base:** lado **Balu** = estado atual do projeto (memória do projeto + commits, jun/2026); lado **Contabilizei** = pesquisa do site público.
> **Relacionado:** [`SOLUCOES-CONTABILIZEI.md`](./SOLUCOES-CONTABILIZEI.md) · [`ANALISE-CONTABILIZEI.md`](./ANALISE-CONTABILIZEI.md)
>
> **Legenda:** ✅ tem · 🟡 parcial / em andamento · 🔴 não tem · ⚫ fora de escopo

## Diff por solução

| Solução | Balu | Contabilizei | Observação |
|---|:---:|:---:|---|
| **Emissão NFS-e** | ✅ | ✅ | Balu: emissor via Focus, gate `focus_habilita_*` |
| **Emissão NFC-e / NF-e** | ✅ | ✅ | Balu: chooser sempre mostra os 3 tipos |
| **Nota manual** | ✅ | 🟡 | Balu: modal multi-step (emissão + manual) |
| **Apuração DAS / Simples** | ✅ | ✅ | Balu: lê de `notas_fiscais`; segregação por anexo |
| **Prévia de imposto ao emitir** | ✅ | 🟡 | Balu: estimativa ao vivo no form — diferencial |
| **Fila de obrigações (a declarar/pagar/vencida)** | ✅ | ✅ | Balu: redesign do `/impostos` |
| **PGDAS-D (transmissão)** | 🟡 | ✅ | Balu: Fase 1 (builder/dry-run) feita; transmit real pendente |
| **DASN-SIMEI** | 🟡 | ✅ | Balu: consulta/histórico ok; transmissão bloqueada na SERPRO |
| **Fator R / CNAE / segregação** | ✅ | ✅ | Balu: modelo multi-atividade |
| **Consulta/emissão DAS via SERPRO** | ✅ | ✅ | Balu: procurador + Simples e MEI |
| **Lucro Presumido** | 🔴 | ✅ | Contabilizei cobre; Balu é Simples/MEI |
| **Obrigações acessórias amplas** (DCTF, SPED, EFD-Reinf, DIRF, DIMOB, DMED, eSocial) | 🔴 | ✅ | Gap relevante de paridade |
| **Folha de pagamento (funcionários)** | 🔴 | ✅ | Contabilizei inclui no Experts |
| **Pró-labore** | 🔴 | ✅ | — |
| **Relatórios contábeis** (DRE, balancete, balanço) | 🔴 | ✅ | — |
| **Certificado Digital A1** | ✅ | ✅ | Balu: guarda cert (`arquivos_auxiliares`); não vende A1 |
| **Busca/consulta CNPJ** | ✅ | ✅ | Balu: via Focus, autofill de regime/CNAE |
| **Abertura de empresa (CNPJ)** | 🟡 | ✅ | Balu: `abertura_empresas` scope=user, **não implementada** |
| **Troca de contador (migração)** | 🔴 | ✅ | — |
| **Conta bancária PJ** | 🔴 | ✅ | Contabilizei.bank — diferencial difícil de copiar |
| **Link de cobrança (Cobre PJ)** | 🔴 | ✅ | — |
| **Escritório virtual / endereço fiscal** | 🔴 | ✅ | Add-on R$ 60/mês |
| **Marketplace de benefícios** (saúde, academia, odonto) | ⚫ | ✅ | Fora do escopo de produto fiscal |
| **Contadores humanos certificados (CRC)** | 🔴 | ✅ | Modelo de serviço, não só software |
| **Calculadoras/geradores gratuitos** (PJ×CLT, Fator R, etc.) | 🔴 | ✅ | Motor de SEO/aquisição |
| **App mobile** | 🔴 | ✅ | Balu é web (Next.js) |

## Leitura rápida

- **Onde o Balu empata ou ganha:** núcleo de **emissão fiscal + apuração**, com dois diferenciais de UX — **prévia de imposto ao vivo na emissão** e **segregação por anexo / Fator R** bem modelados.
- **Gaps de paridade fiscal (caminho natural):** transmissão real de **PGDAS-D** e **DASN** (já em andamento), **obrigações acessórias** e **Lucro Presumido**.
- **Diferenciais estruturais da Contabilizei** (não dá pra copiar com código): contadores humanos, banco PJ próprio, abertura subsidiada e marketplace de benefícios — competir aqui é decisão de modelo de negócio, não de feature.
