# DASN-SIMEI — Declaração Anual do MEI (Integra-MEI) — spec da API SERPRO

**Data:** 2026-06-06
**Fonte:** doc oficial Integra Contador, `pt/solucoes/integra-mei/dasnsimei/` (navegação Soluções →
Integra-MEI → DASN-SIMEI; o apicenter responde de forma intermitente — confirmado ao vivo nesta data).
**Relacionado:** P1.2 do backlog. Espelha o playbook da [PGDAS-D](PGDAS-D-TRANSDECLARACAO11.md).

## O que é
Declaração **anual** simplificada do MEI (DASN-SIMEI) — receita bruta do ano-calendário anterior.
Diferente da PGDAS-D (mensal, do Simples): o MEI **não declara mês a mês** (paga DAS fixo via PGMEI);
a única declaração é esta, anual. **Prazo: até 31 de maio** do ano seguinte ao ano-calendário.

## Solução Integra-MEI (3 sistemas)
- **PGMEI** — DAS mensal (`GERARDASPDF21` já usado) + cód. barras (`22`) + benefício (`23`) + dívida ativa (`24`).
- **CCMEI** — certificado de condição MEI (emitir / consultar dados / situação cadastral).
- **DASN-SIMEI** — a declaração anual (este doc).

## Serviços DASN-SIMEI (`idSistema: DASNSIMEI`, `versaoSistema: 1.0`)

| idServico | Serviço | Função |
|---|---|---|
| `TRANSDECLARACAO151` | Entregar Declaração | Transmite a declaração anual (Original ou Retificadora) ⚠️ **ainda não disponível p/ contratação — pode sofrer alterações** |
| `CONSULTIMADECREC152` | Consultar Declaração | Última declaração/recibo do ano-calendário (sem aviso de indisponibilidade) |
| `GERARDASEXCESSO153` | Emitir DAS de Excesso | DAS do excesso quando a receita passou do teto MEI ⚠️ **ainda não disponível p/ contratação** |

> 🚧 **DISPONIBILIDADE (doc oficial, verificado 2026-06-06):** a página do `TRANSDECLARACAO151` traz
> *"ATENÇÃO: A FUNCIONALIDADE AINDA NÃO ESTÁ DISPONÍVEL PARA CONTRATAÇÃO E PODE SOFRER ALTERAÇÕES"*. Logo o
> **serviço que efetivamente transmite a DASN-SIMEI é pré-lançamento** — não dá pra entregar em produção
> hoje (nem no Trial, que dá 101507), e o **payload pode mudar**. Só `CONSULTIMADECREC152` (consulta) não
> tem esse aviso. **Implicação:** a transmissão do P1.2 depende da SERPRO liberar o serviço; a camada pura
> que montamos (builder/parser) é investimento baixo e pode precisar de ajuste quando sair da pré-fase.

> ⚠️ **Sem `indicadorTransmissao`.** Diferente da PGDAS-D, o `TRANSDECLARACAO151` **não tem dry-run** — a
> transmissão é sempre real. Não dá pra pré-visualizar contra a SERPRO; o gate de confirmação tem que se
> apoiar nos **nossos** valores calculados antes de transmitir.

### 1. Entregar Declaração — `TRANSDECLARACAO151`
**Entrada** (`dados`):
```json
{
  "cnpjCompleto": "11111111111111",
  "anoCalendario": "2021",
  "declaracao": {
    "valorReceitaComercio": 82000.0,   // receita anual: comércio + indústria + transporte de cargas
    "valorReceitaServico": 0.0,        // receita anual: serviços + locação
    "indicadorEmpregado": false        // teve empregado no ano?
  }
}
```
Não há `tipoDeclaracao` no exemplo de entrada (a SERPRO decide Original×Retificadora por cnpj+ano —
**a confirmar**, mas o payload de entrada não tem campo de referência à anterior; mesmo padrão da PGDAS-D).

**Resposta** (`declaracaoTransmitida`):
- `idDeclaracao` (`AAAAAAAAYYYYSSS`), `dataTransmissao`, `codigoTipoDeclaracao` (**1=Original, 2=Retificadora**, "etc." — pode ter mais códigos).
- `nomeEmpresarial`, `ocupacaoProfissional`.
- `reciboEntrega` — PDF do recibo (objeto `arquivoPdf`, base64) + nº de protocolo.
- `excessoReceitaBruta` — DAS de excesso (valores + PDF), quando houve excesso.
- **`multaAtrasoEntrega`** — MAED: notificação + DARF (PDF), quando entregue fora do prazo. **A SERPRO
  calcula a multa por atraso** (mesmo padrão da PGDAS-D — nós só surfamos).
- Todos os documentos vêm como PDF base64 em objetos `arquivoPdf`.

### 2. Consultar Declaração — `CONSULTIMADECREC152`
**Entrada:** `{ "cnpjCompleto": "...", "anoCalendario": "2022" }`.
**Resposta:** array de declarações transmitidas — cnpj/ano, nomeEmpresarial, ocupacaoProfissional,
`idDeclaracao`, dataTransmissão, `codigoTipoDeclaracao`, `reciboEntrega`, `excessoReceita`,
`multaAtrasoEntrega`, limites de receita, valores apropriados e documentos de pagamento (vencimentos +
composição). → usado p/ **detectar se o ano já foi declarado** (Original vs Retificadora) e listar histórico.

### 3. Emitir DAS de Excesso — `GERARDASEXCESSO153` ⚠️ não contratável ainda
**Entrada:** `{ "cnpjCompleto": "...", "anoCalendario": "2022" }`.
**Resposta** (`documentoArrecadacao`): nº do documento (17), PA (`AAAAMM`), vencimento/validade,
valor principal/multa/juros/total, composição por código de receita, PDF base64. **Adiar** (a doc diz
"ainda não está disponível para contratação e pode sofrer alterações").

## Mensagens / erros (DASN-SIMEI)
| Código | Significado | Ação no app |
|---|---|---|
| `EntradaIncorreta-DASNSIMEI-10000` | Dados inválidos (HTTP 400) | erro de validação |
| `Aviso-DASNSIMEI-10001` | CNPJ inválido | erro |
| `Aviso-DASNSIMEI-10002` | Ano fora do período (decadência 6+ anos) | bloquear ano |
| `Aviso-DASNSIMEI-10003` | Contribuinte baixado no ano | aviso |
| `Aviso-DASNSIMEI-10005` | Apuração anterior com alíquota INSS diferente → refazer no PGMEI | aviso/encaminhar |
| `Aviso-DASNSIMEI-10006/10007` | DAS não gerado; regularizar via PGMEI | encaminhar p/ DAS mensal |
| **`Aviso-DASNSIMEI-10008`** | **Receita bruta do ano > limite → desenquadramento obrigatório do SIMEI** | **alerta forte** |
| `Aviso-DASNSIMEI-33001` | Não optante pelo SIMEI | bloquear |
| `Aviso-DASNSIMEI-33101` | Sem excesso p/ gerar DAS de excesso | info |
| `Erro-DASNSIMEI-33XXX` | Falhas internas | retry |
| (sucesso) | HTTP 200, sem código explícito | — |

## Insumos no Balu (de onde vêm os valores)
- **`valorReceitaComercio` × `valorReceitaServico`:** somar as notas do ano-calendário, classificando por
  **tipo de nota** — NFS-e → serviço; NF-e/NFC-e (produto) → comércio. (Mais simples que o anexo do Simples;
  o MEI não usa anexo.) Reaproveita `lerReceitasParaApuracao` agregando por ano.
- **`indicadorEmpregado`:** o MEI tem no máximo 1 empregado. **Gap de dado** — hoje não rastreamos; campo
  simples em `empresas_fiscais` (ou derivar de folha, se houver). Decidir na spec.
- **`anoCalendario`:** ano anterior (declara-se até 31/05 do ano seguinte).

## Disponibilidade no Trial (testado 2026-06-06)
⚠️ **DASN-SIMEI NÃO está no ambiente Trial.** Os 3 serviços (`CONSULTIMADECREC152`,
`TRANSDECLARACAO151`, `GERARDASEXCESSO153`) devolvem `101507 "Runtime Error / Error in Sender"`
(erro de roteamento/backend, não auth) no `…/integra-contador-trial/v1/`, enquanto **PGMEI responde 200**
com o mesmo token demo. Logo: o parser do DASN-SIMEI é **modelado pela doc** (estrutura `declaracaoTransmitida`
acima) e o smoke estrutural fica **adiado p/ e-CNPJ MEI real** (ou até a SERPRO liberar DASN-SIMEI no trial).
Contraste: PGMEI dá pra smoke no Trial sem empresa (ver [[balu-serpro-subscription-gap]]).

## Diferenças-chave vs. PGDAS-D (não confundir)
1. **Anual**, não mensal. Prazo **31/05** (não dia 20).
2. **Sem `indicadorTransmissao`** → **sem dry-run**; transmissão sempre real.
3. Payload **mínimo** (2 receitas + flag empregado) — sem idAtividade, sem 12 meses, sem estabelecimentos.
4. Mesma lógica de **retificadora** (codigoTipoDeclaracao 1/2) e **MAED na resposta**.
5. Tem **DAS de excesso** + sinal de **desenquadramento** (receita > teto).

## Referências
- Soluções: `.../pt/solucoes/integra-mei/`
- DASN-SIMEI serviços: `.../integra-mei/dasnsimei/servicos/{entregar_declaracao,consultar_declaracao,emitir_das_excesso}/`
- Mensagens: `.../integra-mei/dasnsimei/mensagens/`
- SDK Dart (espelha só PGMEI+PGDASD, **não** DASN-SIMEI): `github.com/MarlonSantosDev/serpro_integra_contador_api`
