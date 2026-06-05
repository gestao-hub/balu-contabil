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

## ⚠️ A peça que falta: catálogo `idAtividade`

A SERPRO segmenta por **`idAtividade`** (código de atividade do PGDAS-D — NÃO é CNAE nem o "Anexo X"
direto). Ex.: `1` e `10` no exemplo. Precisamos do **catálogo idAtividade → anexo** (lista fixa da
Receita: "Revenda de mercadorias — Anexo I", "Prestação de serviços — Anexo III", etc.). É curadoria,
no mesmo espírito do `cnae_anexo`. Sem isso, mapeamos receita→atividade no chute.
- Caminho: manual do PGDAS-D (Receita) ou o `idAtividade` que volta no `CONSDECLARACAO13`/extrato.
- MVP possível: empresa de atividade única → 1 atividade; refinar multi-atividade depois.

Outros tributos detalhados (`valoresParaComparacao`): hoje a apuração só dá `valorImposto` agregado;
abrir por tributo exige a repartição do Simples (percentuais por anexo/faixa) — ou deixar
`indicadorComparacao=false` e confiar no cálculo da SERPRO (o dry-run já devolve os valores).

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
