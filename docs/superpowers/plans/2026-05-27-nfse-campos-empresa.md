# Ajuste de campos da aba NFS-e — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remover a inscrição municipal da aba NFS-e (fonte única passa a ser "Dados da empresa") e ocultar Série RPS + Número RPS inicial sem perder os dados no banco.

**Architecture:** Mudança só de UI + payload em `NfseForm.tsx` (remove campo/state/payload de `inscricao_municipal`; remove render/state/payload de `serie_rps` e `numero_rps_inicial`, marcados `// @deferred`) e alinhamento do tipo do cast em `page.tsx`. Como `upsertEmpresaFiscalAction` aplica patch parcial, omitir esses campos preserva os valores existentes em `empresas_fiscais`. Sem migration, sem mudança de schema, sem teste novo (componente não tem suíte; verificação é `tsc` + round-trip ao vivo confirmando preservação).

**Tech Stack:** Next.js 15 (App Router, Server Components/Actions), React client component, Supabase (`empresas_fiscais`), Vitest/tsc.

**Spec:** `docs/superpowers/specs/2026-05-27-nfse-campos-empresa-design.md`

---

### Task 1: Remover Inscrição municipal e ocultar Série/Número RPS no `NfseForm`

**Files:**
- Modify: `app/src/app/(auth)/configuracoes/NfseForm.tsx`

Cinco edições no mesmo arquivo. Os trechos abaixo mostram o estado atual → novo.

- [ ] **Step 1: Encolher o tipo `Initial`** (remove os 3 campos que saem da aba)

Trocar:
```tsx
type Initial = {
  inscricao_municipal?: string | null;
  serie_rps?: string | null;
  numero_rps_inicial?: number | null;
  nfse_usuario_login?: string | null;
  nfse_senha_login?: string | null;
  nfse_token_api?: string | null;
  nfse_habilitada?: boolean | null;
  empresa_fiscal_ativada?: boolean | null;
};
```
por:
```tsx
type Initial = {
  nfse_usuario_login?: string | null;
  nfse_senha_login?: string | null;
  nfse_token_api?: string | null;
  nfse_habilitada?: boolean | null;
  empresa_fiscal_ativada?: boolean | null;
};
```

- [ ] **Step 2: Remover os states `im`, `serie`, `numeroRps`**

Trocar:
```tsx
  const toast = useToast();
  const [im, setIm] = useState(initial?.inscricao_municipal ?? '');
  const [serie, setSerie] = useState(initial?.serie_rps ?? '');
  const [numeroRps, setNumeroRps] = useState(initial?.numero_rps_inicial != null ? String(initial.numero_rps_inicial) : '');
  const [usuario, setUsuario] = useState(initial?.nfse_usuario_login ?? '');
```
por:
```tsx
  const toast = useToast();
  const [usuario, setUsuario] = useState(initial?.nfse_usuario_login ?? '');
```

- [ ] **Step 3: Limpar `resetFromInitial`** (não setar mais os 3 removidos)

Trocar:
```tsx
  function resetFromInitial() {
    setIm(initial?.inscricao_municipal ?? '');
    setSerie(initial?.serie_rps ?? '');
    setNumeroRps(initial?.numero_rps_inicial != null ? String(initial.numero_rps_inicial) : '');
    setUsuario(initial?.nfse_usuario_login ?? '');
    setSenha(initial?.nfse_senha_login ?? '');
    setToken(initial?.nfse_token_api ?? '');
    setAtivada(!!initial?.empresa_fiscal_ativada);
  }
```
por:
```tsx
  function resetFromInitial() {
    setUsuario(initial?.nfse_usuario_login ?? '');
    setSenha(initial?.nfse_senha_login ?? '');
    setToken(initial?.nfse_token_api ?? '');
    setAtivada(!!initial?.empresa_fiscal_ativada);
  }
```

- [ ] **Step 4: Remover os 3 campos do payload do submit** (omiti-los preserva os valores no banco)

Trocar:
```tsx
      const r = await upsertEmpresaFiscalAction({
        municipio_id: mun.id,
        nfse_autenticacao_tipo: mun.autenticacao ?? null,
        inscricao_municipal: im.trim() || null,
        serie_rps: serie.trim() || null,
        numero_rps_inicial: numeroRps.trim() ? Number(numeroRps) : null,
        nfse_usuario_login: cred.login ? (usuario.trim() || null) : null,
        nfse_senha_login: cred.login ? (senha.trim() || null) : null,
        nfse_token_api: cred.token ? (token.trim() || null) : null,
        nfse_habilitada: ativada,         // espelha empresa_fiscal_ativada (v1: toggle único)
        empresa_fiscal_ativada: ativada,
      });
```
por:
```tsx
      const r = await upsertEmpresaFiscalAction({
        municipio_id: mun.id,
        nfse_autenticacao_tipo: mun.autenticacao ?? null,
        nfse_usuario_login: cred.login ? (usuario.trim() || null) : null,
        nfse_senha_login: cred.login ? (senha.trim() || null) : null,
        nfse_token_api: cred.token ? (token.trim() || null) : null,
        nfse_habilitada: ativada,         // espelha empresa_fiscal_ativada (v1: toggle único)
        empresa_fiscal_ativada: ativada,
      });
```

- [ ] **Step 5: Remover o grid dos 3 campos do render e deixar comentário `// @deferred`**

Trocar:
```tsx
      <div className="grid grid-cols-2 gap-4">
        <Field label="Inscrição municipal" value={im} onChange={setIm} disabled={locked} />
        <Field label="Série RPS" value={serie} onChange={setSerie} disabled={locked} />
        <Field label="Número RPS inicial" value={numeroRps} onChange={(v) => setNumeroRps(v.replace(/\D/g, ''))} disabled={locked} />
      </div>
```
por:
```tsx
      {/* @deferred — Inscrição municipal foi movida para a aba "Dados da empresa"
          (companies.inscricao_municipal, fonte única). Série RPS e Número RPS inicial
          ficam ocultos até validação; valores preservados em empresas_fiscais porque o
          submit omite esses campos do patch parcial.
          Ver docs/superpowers/specs/2026-05-27-nfse-campos-empresa-design.md */}
```

> Nota: a função `Field` (rodapé do arquivo) **continua usada** pela fieldset de credenciais — não remover.

- [ ] **Step 6: `tsc` para garantir que não sobraram referências órfãs**

Run: `cd app && npx tsc --noEmit`
Expected: zero erros (nenhuma referência a `im`/`serie`/`numeroRps`/`setIm`/`setSerie`/`setNumeroRps` restante).

- [ ] **Step 7: Commit**

```bash
git add "app/src/app/(auth)/configuracoes/NfseForm.tsx"
git commit -m "feat(nfse): remove inscrição municipal da aba e oculta série/número RPS

IM passa a ter fonte única em Dados da empresa (companies). Série RPS e número
RPS inicial ficam @deferred (ocultos até validação); o submit omite os três
campos do patch parcial, preservando os valores em empresas_fiscais."
```

---

### Task 2: Alinhar o cast de `initial` em `page.tsx` e verificar fim-a-fim

**Files:**
- Modify: `app/src/app/(auth)/configuracoes/page.tsx`

- [ ] **Step 1: Encolher o cast do `initial` passado ao `NfseForm`** (alinhar ao novo tipo `Initial`)

Trocar:
```tsx
          initial={
            empresaFiscal as {
              inscricao_municipal?: string | null;
              serie_rps?: string | null;
              numero_rps_inicial?: number | null;
              nfse_usuario_login?: string | null;
              nfse_senha_login?: string | null;
              nfse_token_api?: string | null;
              nfse_habilitada?: boolean | null;
              empresa_fiscal_ativada?: boolean | null;
            } | null
          }
```
por:
```tsx
          initial={
            empresaFiscal as {
              nfse_usuario_login?: string | null;
              nfse_senha_login?: string | null;
              nfse_token_api?: string | null;
              nfse_habilitada?: boolean | null;
              empresa_fiscal_ativada?: boolean | null;
            } | null
          }
```

- [ ] **Step 2: `tsc` + `vitest`**

Run: `cd app && npx tsc --noEmit && npx vitest run`
Expected: tsc zero erros; vitest 41/41 (nenhuma suíte cobre `NfseForm`; os helpers não mudaram).

- [ ] **Step 3: Conferir o estado atual no banco ANTES do teste de UI** (baseline para provar preservação)

Run (a partir de `app`, lê `.env.local`):
```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const company = "db2b742d-dcd6-4322-b91e-7a776fd921f9";
const { data } = await sb.from("empresas_fiscais").select("inscricao_municipal, serie_rps, numero_rps_inicial").eq("empresa_id", company).maybeSingle();
console.log("BASELINE empresas_fiscais:", JSON.stringify(data));
'
```
Expected: `{"inscricao_municipal":"987654","serie_rps":"RPS-A","numero_rps_inicial":1}`.

- [ ] **Step 4: Round-trip na UI** (dev server em :3000, empresa de teste Curitiba)

Navegar para `http://localhost:3000/configuracoes?tab=nfse`. Confirmar que a aba **não** mostra mais os campos Inscrição municipal, Série RPS e Número RPS inicial — só o bloco derivado do município + toggle "Empresa fiscal ativada" (Curitiba não exige credenciais). Clicar **Editar** → marcar/garantir o toggle → **Salvar** (toast "Configuração de NFS-e salva.").

- [ ] **Step 5: Provar preservação no banco DEPOIS do save**

Run (mesmo script do Step 3):
```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const company = "db2b742d-dcd6-4322-b91e-7a776fd921f9";
const { data } = await sb.from("empresas_fiscais").select("inscricao_municipal, serie_rps, numero_rps_inicial, empresa_fiscal_ativada").eq("empresa_id", company).maybeSingle();
console.log("APÓS SAVE empresas_fiscais:", JSON.stringify(data));
'
```
Expected: `inscricao_municipal` segue `"987654"`, `serie_rps` segue `"RPS-A"`, `numero_rps_inicial` segue `1` (o save não tocou nesses campos). `empresa_fiscal_ativada` reflete o toggle.

- [ ] **Step 6: Commit**

```bash
git add "app/src/app/(auth)/configuracoes/page.tsx"
git commit -m "chore(nfse): alinha cast de initial do NfseForm ao tipo enxuto"
```

---

## Notas de verificação final

- A aba "Dados da empresa" continua editando `companies.inscricao_municipal` (não mexemos no `DadosEmpresaForm`).
- O valor stale `empresas_fiscais.inscricao_municipal` (`987654`) permanece — inofensivo, fora do fluxo da aba; a emissão (PR 2.1) define a fonte.
- Série/Número RPS retomam a partir da spec quando o usuário validar a regra.
