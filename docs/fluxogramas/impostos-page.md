# Fluxo: Página /impostos

```mermaid
flowchart LR
    A(["Acessa /impostos"]) --> B["Server: carrega\nregime, apurações,\nguias, declarações"]

    B --> C{"Regime\nconfigurado?"}
    C -->|não| D(["BloqueioFiscal\nCTA: configurar regime"])

    C -->|MEI| MEI["CompetenciaAtualCard\n+ DeclaracoesMeiSection\n+ HistoricoGuias"]
    C -->|Simples| SN["CompetenciaAtualCard\n+ DeclaracoesSection\n+ HistoricoGuias\n+ ConsultarSerproButton"]

    MEI --> E{"Tem apuração\nou guia?"}
    E -->|não| F["EmptyState\nCalcular agora / Gerar DAS"]
    E -->|sim| G["Exibe valor, alíquota,\nvencimento, status"]

    F -->|Calcular agora| H["/impostos/novo\niniciarApuracaoAction"]
    F -->|Gerar DAS direto| I["GerarDasButton\nSERPRO PGMEI"]
    I -->|ok| J["upsert guias_fiscais\nrevalida página"]

    G --> K{"Status guia?"}
    K -->|paga| L["GuiaActions\ncopiar linha / PDF"]
    K -->|gerada/pendente| M["GerarDasButton\nSERPRO PGMEI"]
    M -->|ok| J

    MEI --> N["ConsultarDasnSimeiButton\nSERPRO DASN-SIMEI"]
    N -->|ok| O["upsert declaracoes_fiscais\nrevalida página"]

    SN --> P{"Tem apuração\nou guia?"}
    P -->|não| Q["EmptyState\nCalcular agora / Gerar DAS Simples"]
    P -->|sim| R["Exibe valor, anexo,\nRBT12, alíquota, vencimento"]

    Q -->|Calcular agora| H
    Q -->|Gerar DAS Simples| S["GerarDasSimplesButton\nSERPRO GERARDAS12"]
    S -->|ok| T["upsert guias_fiscais\nrevalida página"]

    R --> U{"Status guia?"}
    U -->|paga| L
    U -->|não paga| S

    R --> V["PreviewDeclaracaoButton\nPGDAS-D dry-run\nindicadorTransmissao=false"]
    V -->|ok| W["Exibe valores devidos\nsem transmitir"]

    SN --> X["ConsultarSerproButton\nCONSDECLARACAO13\n+ PAGAMENTOS71"]
    X -->|ok| Y["upsert guias_fiscais\n+ declaracoes_fiscais\nrevalida página"]
```

## Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `app/(auth)/impostos/page.tsx` | Server component — carrega regime, apurações, guias, declarações |
| `app/(auth)/impostos/actions.ts` | Todas as server actions da página |
| `app/(auth)/impostos/CompetenciaAtualCard.tsx` | Card do mês atual com empty state e botões de ação |
| `app/(auth)/impostos/GerarDasButton.tsx` | Gera DAS MEI via SERPRO PGMEI |
| `app/(auth)/impostos/GerarDasSimplesButton.tsx` | Gera DAS Simples via SERPRO GERARDAS12 |
| `app/(auth)/impostos/PreviewDeclaracaoButton.tsx` | Dry-run PGDAS-D (indicadorTransmissao=false) |
| `app/(auth)/impostos/ConsultarSerproButton.tsx` | Consulta CONSDECLARACAO13 + PAGAMENTOS71 |
| `app/(auth)/impostos/ConsultarDasnSimeiButton.tsx` | Consulta DASN-SIMEI (histórico MEI) |
| `app/(auth)/impostos/GuiaActions.tsx` | Copiar linha digitável / abrir PDF |
| `app/(auth)/impostos/HistoricoGuias.tsx` | Tabela de guias anteriores |
| `app/(auth)/impostos/DeclaracoesSection.tsx` | Tabela PGDAS-D (Simples) |
| `app/(auth)/impostos/DeclaracoesMeiSection.tsx` | Tabela DASN-SIMEI (MEI) |
