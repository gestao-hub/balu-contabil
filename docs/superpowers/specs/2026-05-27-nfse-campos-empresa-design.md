# Ajuste da aba NFS-e — Inscrição municipal + campos RPS (design)

**Data:** 2026-05-27
**Status:** aprovado (brainstorming) — pronto para writing-plans
**Branch:** `fix/nfse-campos-empresa`
**Fontes:** `NfseForm.tsx` (PR 1.5), `configuracoes/page.tsx`, `configuracoes/actions.ts` (`upsertEmpresaFiscalAction`), tabelas `companies` / `empresas_fiscais` / `municipios_nfse`.

## Contexto

A aba NFS-e (PR 1.5) mistura três tipos de campo:

1. **Derivado do município** (já read-only): provedor, autenticação, cancelamento, liberação RPS — vêm de `municipios_nfse` (casado pelo endereço da empresa).
2. **Config própria da empresa** (editável, sem outra origem): série RPS, número RPS inicial, credenciais (usuário/senha/token), toggle "Empresa fiscal ativada".
3. **Duplicado**: a **inscrição municipal** é editável tanto em "Dados da empresa" (`companies.inscricao_municipal`) quanto na NFS-e (`empresas_fiscais.inscricao_municipal`). Hoje os valores estão até dessincronizados (ex.: empresa de teste com `companies.inscricao_municipal = ""` e `empresas_fiscais.inscricao_municipal = "987654"`).

Decisão do usuário após revisão campo a campo:
- **Inscrição municipal** passa a viver **apenas em "Dados da empresa"** (`companies`).
- **Série RPS** e **Número RPS inicial** ficam **ocultos por ora** (a regra precisa de validação posterior) — sem perder os dados.

## Decisões aprovadas

1. **Inscrição municipal sai da aba NFS-e.** Fonte única = `companies.inscricao_municipal` (editada na aba "Dados da empresa", que já tem o campo). O `NfseForm` deixa de ler e de escrever `empresas_fiscais.inscricao_municipal`.
2. **Série RPS + Número RPS inicial ocultos (deferidos).** Removidos da UI e do payload, marcados com comentário `// @deferred` para retorno após validação. **Sem** apagar colunas e **sem** sobrescrever valores: como o `upsertEmpresaFiscalAction` aplica patch parcial, omiti-los do patch preserva o que já está no banco.
3. **Sem migration / sem mudança de schema.** Apenas UI + payload. Valores hoje em `empresas_fiscais` (`inscricao_municipal`, `serie_rps`, `numero_rps_inicial`) ficam intactos; deixam de ser tocados por esta aba.
4. Mantidos sem mudança: bloco derivado (read-only), credenciais condicionais (`credenciaisDaAutenticacao`), toggle "Empresa fiscal ativada".

## Escopo

- `src/app/(auth)/configuracoes/NfseForm.tsx`: remover o campo Inscrição municipal (render + state `im` + `resetFromInitial` + entrada no payload + campo `inscricao_municipal` do tipo `Initial`). Remover o render de Série RPS e Número RPS inicial (+ states `serie`/`numeroRps` + `resetFromInitial` + entradas no payload), com comentário `// @deferred`. Remover o `<div className="grid grid-cols-2 gap-4">` que agrupava os três campos (fica vazio).
- `src/app/(auth)/configuracoes/page.tsx`: o cast de `initial` passado ao `NfseForm` não precisa mais expor `inscricao_municipal`/`serie_rps`/`numero_rps_inicial` (ajuste de tipo cosmético; opcional manter, mas alinhar ao novo `Initial`).

### Fora de escopo

- Emissão de NFS-e (PR 2.1) — quem decidirá qual tabela ler como fonte de IM no momento da emissão.
- Migração/limpeza do valor stale em `empresas_fiscais.inscricao_municipal` (`987654` na empresa de teste): fica como está; não é lido nem escrito pela aba. Não há card.
- Regra definitiva de série/número RPS (validação pendente do usuário) — só ocultar agora.
- Aplicar flags de validação do município (`serie_rps_so_numeros`, `im_zeros_esquerda`) — não solicitado.

## Arquitetura

### `NfseForm.tsx`

Estado final do componente após a edição:

- **Props `Initial`** perde `inscricao_municipal`, `serie_rps`, `numero_rps_inicial`. Mantém `nfse_usuario_login`, `nfse_senha_login`, `nfse_token_api`, `nfse_habilitada`, `empresa_fiscal_ativada`.
- **States removidos:** `im`, `serie`, `numeroRps`. Mantidos: `usuario`, `senha`, `token`, `ativada`, `editing`, `busy`.
- **`resetFromInitial`** deixa de setar os três removidos.
- **Render:** o grid de 3 campos (linhas ~124-128) é removido. O fluxo passa a ser: bloco derivado → aviso de certificado (se `cred.certificado`) → `<fieldset>` de credenciais (se `cred.login || cred.token`) → toggle de ativação → botões Editar/Salvar/Cancelar.
- **Comentário `// @deferred`** acima do fluxo, registrando que Inscrição municipal foi movida para "Dados da empresa" e que Série/Número RPS estão ocultos aguardando validação (referência a esta spec).

### `upsertEmpresaFiscalAction` (payload do submit)

Patch enviado passa a ser:

```ts
await upsertEmpresaFiscalAction({
  municipio_id: mun.id,
  nfse_autenticacao_tipo: mun.autenticacao ?? null,
  nfse_usuario_login: cred.login ? (usuario.trim() || null) : null,
  nfse_senha_login: cred.login ? (senha.trim() || null) : null,
  nfse_token_api: cred.token ? (token.trim() || null) : null,
  nfse_habilitada: ativada,
  empresa_fiscal_ativada: ativada,
});
```

Sem `inscricao_municipal`, `serie_rps`, `numero_rps_inicial` (omitidos → não alterados no banco). A action não muda (já recebe `Partial<EmpresaFiscalInput>`).

## Fluxo de dados

`page.tsx` (server) resolve município pelo endereço → `<NfseForm initial={empresaFiscal} municipio={...} cidade uf>` → usuário edita credenciais/ativação → submit envia patch reduzido → `upsertEmpresaFiscalAction` faz upsert parcial em `empresas_fiscais` (campos omitidos preservados) → toast.

Inscrição municipal: lida/escrita só pelo `DadosEmpresaForm` (`companies`), sem mudança nesse form.

## Tratamento de erro

Sem lógica nova. O caminho de erro do save (`upsertEmpresaFiscalAction` retornando `{ ok:false }`) e o caso "município não suportado" (early-return com aviso) permanecem.

## Verificação

- `tsc --noEmit` zero erros (states/props removidos não deixam referências órfãs).
- `vitest run` segue verde (nenhum teste cobre `NfseForm`; os helpers `municipio-nfse`/`regime` não mudam).
- UI/manual na empresa de teste (Curitiba): aba NFS-e renderiza **sem** Inscrição municipal, Série RPS e Número RPS inicial; mostra bloco derivado + toggle (Curitiba não exige credenciais). Editar → Salvar.
- **Preservação no banco:** após salvar a aba, query confirma que `empresas_fiscais` mantém `inscricao_municipal = "987654"`, `serie_rps = "RPS-A"`, `numero_rps_inicial = 1` (o save não os tocou).
- Aba "Dados da empresa" continua editando `companies.inscricao_municipal` normalmente.

## Premissas / carry-forward

- O valor stale `empresas_fiscais.inscricao_municipal` (`987654`) permanece no banco — inofensivo, fora do fluxo da aba. A emissão (PR 2.1) definirá a fonte de IM.
- Série/Número RPS voltam após validação do usuário — esta spec é o ponto de retomada.
- A duplicação de IM era pré-existente; este ajuste a resolve no nível de UI (uma única tela edita o valor).
