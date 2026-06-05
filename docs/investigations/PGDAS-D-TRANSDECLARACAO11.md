# PGDAS-D — Transmissão (TRANSDECLARACAO11) — spec da API SERPRO

**Data:** 2026-06-05
**Fonte:** [apicenter SERPRO Integra Contador — PGDAS-D](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/sistemas/pgdasd/),
[cenários PGDAS-D](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/cenarios_trial/cenarios_pgdasd/),
[mensagens/erros](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/mensagens/),
SDK Dart da comunidade [MarlonSantosDev/serpro_integra_contador_api](https://github.com/MarlonSantosDev/serpro_integra_contador_api).
**Para:** P0.1 completo (transmitir a declaração mensal do Simples).

## 🔑 Achado que destrava o teste seguro

O payload tem **`indicadorTransmissao` (boolean)**:
- **`false` → a SERPRO CALCULA e devolve os valores devidos, mas NÃO transmite** à Receita.
  É o **dry-run real**: validação autoritativa da SERPRO, sem efeito legal. ✅ É aqui que testamos.
- **`true` → transmite de verdade** (escrita oficial na Receita). Só com confirmação + sign-off.

E **`indicadorComparacao` (boolean)** + **`valoresParaComparacao[]`**: quando você transmite com
comparação, manda os tributos que VOCÊ calculou e a SERPRO **recusa transmitir se não baterem** com o
cálculo dela (erro MSG_ISN_035: *"Foi solicitada transmissão... porém a lista com os valores devidos
não é igual aos valores calculados"*). Rede de segurança extra antes do transmit real.

Conclusão: a barreira do "só produção / sem homologação" some — o `indicadorTransmissao=false` é uma
homologação de fato, na própria produção, sem transmitir.

> ✅ **CONFIRMADO na doc oficial** (`.../servicos/entregar_declaracao_mensal_entrada/`): *"indicadorTransmissao
> — Indica se a declaração deve ser transmitida. No caso de 'false', serão devolvidos os valores devidos
> sem transmissão."* E *(b)* "no caso de qualquer erro, nenhum dado será salvo"; *(d)* receitas brutas de
> períodos já transmitidos são **ignoradas** (a SERPRO usa as dela). **Validado ao vivo 2026-06-05**:
> dry-run AL Piscinas 202605 → SERPRO calculou **R$ 1.746,55**, `transmitida=false`, e a 202605 seguiu
> não-declarada (guard antes/depois). Ver [[balu-pgdasd-transmissao]].

### ⚠️ Gotchas do payload (descobertos no dry-run, já tratados no código)
1. **`folhasSalario` só com atividade Fator R** (idAtividade 10/11/12/29). Senão a SERPRO recusa
   (*"Foi informada a lista de Folha de Salários mas não há atividade com este requisito"*). → enviar `[]`.
2. **TODOS os estabelecimentos** (matriz + filiais ativas, mesmo zeradas). A SERPRO nomeia os faltantes
   no erro (*"...não foram enviados no campo Estabelecimento: <CNPJ>"*) → extrair os CNPJs e reenviar com
   eles como estabelecimentos vazios (não há API pública limpa de filiais por raiz).

## Envelope (igual ao GERARDAS12, fluxo procurador)

```
contratante / autorPedidoDados / contribuinte (CNPJ),
pedidoDados: { idSistema: 'PGDASD', idServico: 'TRANSDECLARACAO11', versaoSistema: '1.0',
               dados: JSON.stringify(<estrutura abaixo>) }
```
Rota: `POST /integra-contador/v1/Declarar` (produção, mTLS + token procurador). Falta o wrapper
`declararComProcurador` (só existem `consultarComProcurador`/`emitirComProcurador`).

## Estrutura do `dados` (exemplo oficial verbatim)

```json
{
  "cnpjCompleto": "00000000000100",
  "pa": 202101,
  "indicadorTransmissao": true,
  "indicadorComparacao": true,
  "declaracao": {
    "tipoDeclaracao": 1,
    "receitaPaCompetenciaInterno": 10000.00,
    "receitaPaCompetenciaExterno": 0.00,
    "receitaPaCaixaInterno": null,
    "receitaPaCaixaExterno": null,
    "valorFixoIcms": 100.00,
    "valorFixoIss": null,
    "receitasBrutasAnteriores": [
      {"pa": 202001, "valorInterno": 100.00, "valorExterno": 200.00},
      {"pa": 202002, "valorInterno": 300.00, "valorExterno": 0.00}
      /* ... 12 meses (RBT12) ... */
    ],
    "folhasSalario": [
      {"pa": 202001, "valor": 2000.00}
      /* ... 12 meses (Fator R) ... */
    ],
    "naoOptante": null,
    "estabelecimentos": [
      {
        "cnpjCompleto": "0000000000100",
        "atividades": [
          {
            "idAtividade": 1,
            "valorAtividade": 4000.00,
            "receitasAtividade": [
              {
                "valor": 4000.00,
                "codigoOutroMunicipio": null,
                "outraUf": null,
                "isencoes": [{"codTributo": 1007, "valor": 100.00, "identificador": 1}],
                "reducoes": [{"codTributo": 1007, "valor": 1500.00, "percentualReducao": 50.00, "identificador": 1}],
                "qualificacoesTributarias": [],
                "exigibilidadesSuspensas": null
              }
            ]
          },
          {
            "idAtividade": 10,
            "valorAtividade": 6000.00,
            "receitasAtividade": [
              {"valor": 6000.00, "codigoOutroMunicipio": 9701, "outraUf": "DF",
               "isencoes": null, "reducoes": null, "qualificacoesTributarias": null, "exigibilidadesSuspensas": null}
            ]
          }
        ]
      }
    ]
  },
  "valoresParaComparacao": [
    {"codigoTributo": 1001, "valor": 23.20},
    {"codigoTributo": 1002, "valor": 18.20},
    {"codigoTributo": 1004, "valor": 66.53},
    {"codigoTributo": 1005, "valor": 14.43},
    {"codigoTributo": 1006, "valor": 222.64},
    {"codigoTributo": 1007, "valor": 100.00},
    {"codigoTributo": 1010, "valor": 120.60}
  ]
}
```

### Códigos de tributo (`codigoTributo`)
`1001`=IRPJ · `1002`=CSLL · `1004`=COFINS · `1005`=PIS/Pasep · `1006`=INSS/CPP · `1007`=ICMS · `1010`=ISS.

### Campos — mapeamento com o que JÁ temos
| Campo SERPRO | De onde vem (Balu) |
|---|---|
| `pa` | competência (YYYYMM) |
| `receitaPaCompetenciaInterno` | `receitaMes` da apuração (mercado interno) |
| `receitaPaCompetenciaExterno` | exportação (hoje 0 — não distinguimos ainda) |
| `receitasBrutasAnteriores[]` (12) | as receitas que já lemos p/ o RBT12 (por mês, interno) |
| `folhasSalario[]` (12) | tabela `folha_mensal` (pró-labore+salários+encargos) |
| `estabelecimentos[].atividades[].valorAtividade` | a **receita segregada por anexo** que construímos |
| `valoresParaComparacao[]` | os tributos da apuração (precisa abrir o `valorImposto` por tributo) |

## Catálogo `idAtividade` (RESOLVIDO — fonte: dados_de_domínio)

A SERPRO segmenta por **`idAtividade`** (código de atividade do PGDAS-D, 43 valores). **Não é só o
anexo** — codifica anexo **+** substituição tributária (ST) **+** retenção de ISS **+** município do
ISS (próprio × outro) **+** exterior **+** sujeição ao Fator R. Tabela completa no SDK espelho:
`github.com/MarlonSantosDev/serpro_integra_contador_api` → `bk.cursor/rules/pgdasd/pgdasd_dados_de_dominio.md`.

**Mapa idAtividade → anexo (casos principais):**
| Anexo | idAtividade (caso comum: município próprio, sem ST, sem retenção) | Variações |
|---|---|---|
| **I** (revenda/comércio) | **1** (sem ST) | 2 (com ST), 3 (exterior) |
| **II** (indústria) | **4** (sem ST) | 5 (com ST), 6 (exterior) |
| **III** locação bens móveis | **7** | 8 (exterior) |
| **III↔V** serviço sujeito a Fator R | **11** (ISS próprio) | 10 (outro muni), 12 (c/ retenção), 29 (exterior) |
| **III** serviço não-Fator-R | **14** (ISS próprio) | 13 (outro muni), 15 (c/ retenção), 30 (exterior) |
| **III** construção civil 7.02/7.05 | **20** | 19 (outro muni), 21 (retenção), 32 (exterior) |
| **IV** serviço | **17** | 16 (outro muni), 18 (retenção), 31 (exterior) |
| **IV** construção civil 7.02/7.05 | **23** | 22 (outro muni), 24 (retenção), 33 (exterior) |
| escritório contábil (ISS fixo) | 9 | 28 (exterior) |
| transporte coletivo municipal (III) | 26 | 25, 27 |
| transporte/comunicação interest. (ICMS) | 34–39 | — |
| IPI + ISS simultâneo | 40–43 | — |

> 🔑 **Fator R é a SERPRO que decide**: para serviço sujeito a Fator R usamos `idAtividade` 10/11/12 e
> mandamos `folhasSalario` — a SERPRO calcula folha÷RBT12 e aplica **Anexo III ou V sozinha**. Não
> precisamos cravar III/V na declaração (a nossa decisão local do P0.3 continua valendo só pra
> estimativa/exibição).

**Onde mora a curadoria:** o `idAtividade` comum de cada empresa é função do CNAE — proposta:
adicionar `id_atividade_pgdas` ao catálogo `cnae_anexo` (default do caso comum por CNAE). As variações
por nota (retenção de ISS, outro município, ST) são per-nota e ficam pra refinamento; o MVP usa o
default por CNAE.

### Outros domínios
- **`tipoDeclaracao`**: `1`=Original, `2`=Retificadora.
- **`codigoTributo`** (já no doc): +`1008`=IPI.
- **Tipo de isenção** (campo `isencoes[].identificador`): 1=Imunidade, 3=Lançamento de Ofício,
  8=Substituição Tributária, 9=Monofásica, 10=Antecipação c/ encerramento, 11=Retenção de ISS.
- **Tipo de redução** (`reducoes[].identificador`): 1=Normal, 2=Cesta básica.

**`valoresParaComparacao`** (tributos detalhados): hoje a apuração só dá `valorImposto` agregado; abrir
por tributo exigiria a repartição do Simples. **Decisão p/ o MVP:** `indicadorComparacao=false` — a
SERPRO calcula e devolve os tributos (o dry-run já mostra os valores). A comparação fica como reforço
opcional num passo futuro.

## Estratégia escalonada (confirmada pela API)
1. **Builder + dry-run (`indicadorTransmissao=false`, `indicadorComparacao=false`):** monta o `dados`
   da apuração+folha, chama `/Declarar`, e mostra **os valores que a SERPRO calculou** pro contador
   conferir. Zero efeito legal. Persiste nada (ou um rascunho).
2. **Transmit real (`indicadorTransmissao=true`):** atrás de confirmação explícita; idealmente
   `indicadorComparacao=true` com `valoresParaComparacao` da apuração p/ a SERPRO recusar divergência.
   Testar 1 competência real (ex.: 202605 AL Piscinas) com sign-off. Retificadora (`tipoDeclaracao`)
   como rede.

## Referências
- Serviço: `https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/sistemas/pgdasd/`
- Mensagens/erros (MSG_ISN_*): `.../solucoes/integra-sn/pgdasd/mensagens/`
- SDK Dart (modelos prontos): `https://github.com/MarlonSantosDev/serpro_integra_contador_api`
