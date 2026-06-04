# Spec — Dados da empresa: refletir a Receita (empresa existente)

**Data:** 2026-06-04
**Origem:** discussão de produto — dados oficiais do CNPJ (endereço, razão social) são registro legal
na Receita; o app deve **refletir**, não deixar o usuário "alterar" livremente. Decisões fechadas no
brainstorming 2026-06-04.

## Problema

O `DadosEmpresaForm` (aba "Dados da empresa", empresa **ativa**) hoje, ao clicar "Editar", libera
**todos** os campos. Mas razão social e endereço são fatos registrados na Receita — mudar isso é um
processo lá, não no app. Editar livremente cria divergência do registro legal e pode gerar nota com
endereço errado. Queremos que os campos oficiais **reflitam** a Receita, com uma escotilha de
correção controlada para gaps da fonte.

## Escopo (decisões fechadas)

- **Empresa existente/ativa apenas.** O **fluxo de abertura é INTOCADO** — `configuracoes/page.tsx`
  já roteia empresa `em_abertura` para `AberturaInfoView` (read-only separado); o `DadosEmpresaForm`
  só renderiza para empresa ativa. Nada de abertura/alteração (`abertura_alteracoes`, `AberturaWizard`)
  é tocado.
- **Reflexo + escotilha (decisão B):** campos oficiais read-only por padrão; um override manual
  discreto destrava para casos de erro/gap da fonte, com aviso.
- **Re-sync via drift existente (decisão A):** "Atualizar da Receita" grava no local e reusa o
  mecanismo `focus_fields_dirty_at` → "Sincronizar com Focus" (emissão). Sem acoplar o PUT.

### Fora de escopo
Fluxo de abertura; alterar o motor de sync Focus; o regime (vive em `RegimeTributarioForm`, com seu
próprio autofill da Focus); refresh de `código município` por este botão (não vem do `/v2/cnpjs`).

## Classificação dos campos

| Grupo | Campos | Comportamento |
|---|---|---|
| **Oficiais** (Receita/Focus `/v2/cnpjs`) | `razao_social`, `logradouro`, `numero`, `sem_numero`, `complemento`, `bairro`, `municipio`, `uf`, `cep`, `codigo_municipio` | read-only (badge "Receita"), inclusive no modo edição |
| **Manuais** (Receita não fornece) | `nome` (fantasia), `inscricao_estadual`, `inscricao_municipal`, `telefone`, `email` | editáveis no modo edição |
| **Imutável** | `cnpj` | read-only sempre (como hoje) |

Constante compartilhada `CAMPOS_OFICIAIS_RECEITA` (lista dos códigos oficiais) — fonte única para o
form (o que travar) e a action (o que gravar). `codigo_municipio` é oficial/read-only mas **não** é
atualizado pelo botão (não vem do `/v2/cnpjs`); mantido pelo cadastro/snapshot Focus. Sinalizar na UI.

## Comportamento da UI (`DadosEmpresaForm`)

- **Padrão (locked):** tudo read-only. Botões: **"Editar"** + **"Atualizar da Receita"**.
- **"Editar":** destrava **só os campos manuais**; oficiais seguem travados com badge "Receita".
  Footer Salvar/Cancelar (como hoje). Salvar usa `updateCompanyAction` (inalterado).
- **"Atualizar da Receita":** chama `atualizarDadosReceitaAction(id)` (ver abaixo); atualiza os campos
  oficiais na tela; toast "Dados atualizados da Receita.".
- **Escotilha (override):** no modo edição, um link discreto **"editar dados da Receita manualmente"**
  destrava os campos oficiais, com aviso inline *"estes dados devem refletir a Receita — altere lá
  primeiro"*. O "Buscar CEP" (ViaCEP) atual fica disponível só nesse modo manual.

## `atualizarDadosReceitaAction(id)` (server)

1. Valida sessão + ownership (`company_id` do usuário).
2. Lê o `cnpj` da empresa; chama `lookupCnpj(cnpj)` (Focus `/v2/cnpjs`, já existe em
   `lib/fiscal/cnpj-lookup.ts`).
3. Monta o patch oficial via helper puro `camposOficiaisDaReceita(lookup)` → `{ razao_social,
   logradouro, numero, complemento, bairro, municipio, uf, cep }` (só os campos não-nulos que a
   consulta traz; `codigo_municipio` não vem).
4. Lê a empresa atual, **mescla** o patch oficial por cima dos valores atuais, e chama
   `updateCompanyAction(id, objetoCompleto)`. (Não dá pra passar patch parcial: `updateCompanyAction`
   valida com `CompanySchema` completo — endereço obrigatório. Por isso mesclamos sobre os valores
   atuais e enviamos o objeto inteiro.) O `updateCompanyAction` já **bumpa `focus_fields_dirty_at`**
   quando campo Focus-relevante muda → Diagnóstico mostra "Sincronizar com Focus" (decisão A; sem PUT
   acoplado aqui).
5. Retorna `{ ok: true, data: <campos atualizados> }` para o form refletir, ou `{ ok: false, error }`.
   Erros de rede/404 da Focus → mensagem clara (reusa `classifyError` do cnpj-lookup).

## O que NÃO muda

- `updateCompanyAction` segue igual (Salvar; só bumpa drift se campo oficial mudar — o que só ocorre
  via escotilha).
- Mecanismo de drift/sync Focus (`focus_fields_dirty_at`, "Sincronizar com Focus").
- CNPJ sempre read-only.
- Fluxo de abertura.

## Testes

- `camposOficiaisDaReceita(lookup)` (puro): extrai os campos oficiais não-nulos; ignora os que não
  vêm (`codigo_municipio`, nome fantasia, IE/IM, telefone, email); retorna `{}` se lookup vazio.
- `CAMPOS_OFICIAIS_RECEITA` vs campos manuais: nenhum overlap (teste de sanidade da constante).
- A action é I/O (lookup + update) — coberta indiretamente; o teste foca no helper puro.

## Arquivos

- **Modify** `app/src/app/(auth)/configuracoes/DadosEmpresaForm.tsx` — split oficial/manual, badge,
  botão "Atualizar da Receita", escotilha.
- **Modify** `app/src/app/(auth)/configuracoes/actions.ts` — `atualizarDadosReceitaAction` + helper
  `camposOficiaisDaReceita` (ou em `lib/fiscal/cnpj-lookup.ts`) + constante `CAMPOS_OFICIAIS_RECEITA`.
- **Create** teste do helper puro.
