# Confirmação ao substituir certificado A1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir um modal de confirmação (`PopupConfirm`, destructive) antes de substituir um certificado A1 já existente, alertando do impacto nos fluxos dependentes.

**Architecture:** Mudança só em `CertificadoForm.tsx`. O upload atual vira `doUpload()`; o `handleSubmit` valida arquivo+senha e, quando há certificado (`enviadoEm`), abre o `PopupConfirm` em vez de subir direto — o upload só roda no `onConfirm`. Primeiro envio (sem certificado) sobe direto. Reusa o `PopupConfirm` existente; sem mudança em action/schema/storage.

**Tech Stack:** Next.js 15 (client component), React, `PopupConfirm` (dialog nativo). Sem teste novo (componente sem suíte; verificação por `tsc` + round-trip ao vivo).

**Spec:** `docs/superpowers/specs/2026-05-27-cert-substituir-confirm-design.md`

---

### Task 1: Modal de confirmação na substituição no `CertificadoForm`

**Files:**
- Modify: `balu-next/src/app/(auth)/configuracoes/CertificadoForm.tsx`

Três edições no mesmo arquivo.

- [ ] **Step 1: Importar o `PopupConfirm`**

Trocar:
```tsx
import { useRef, useState } from 'react';
import { Loader2, Upload, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { uploadCertificadoAction } from './actions';
```
por:
```tsx
import { useRef, useState } from 'react';
import { Loader2, Upload, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { uploadCertificadoAction } from './actions';
```

- [ ] **Step 2: Adicionar state `confirmOpen` e separar `doUpload`/`handleSubmit`**

Trocar:
```tsx
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [senha, setSenha] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast('warning', 'Selecione o arquivo do certificado (.pfx).'); return; }
    if (!senha.trim()) { toast('warning', 'Informe a senha do certificado.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('senha', senha);
      const r = await uploadCertificadoAction(fd);
      if (!r.ok) { toast('error', r.error); return; }
      if (r.warning) toast('warning', r.warning);
      else toast('success', 'Certificado enviado.');
      setSenha('');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setBusy(false);
    }
  }
```
por:
```tsx
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [senha, setSenha] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Sobe o certificado de fato. Fecha o modal ao terminar; reseta o form só no sucesso.
  async function doUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('senha', senha);
      const r = await uploadCertificadoAction(fd);
      if (!r.ok) { toast('error', r.error); return; }
      if (r.warning) toast('warning', r.warning);
      else toast('success', 'Certificado enviado.');
      setSenha('');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { toast('warning', 'Selecione o arquivo do certificado (.pfx).'); return; }
    if (!senha.trim()) { toast('warning', 'Informe a senha do certificado.'); return; }
    if (enviadoEm) setConfirmOpen(true); // substituição → confirma antes
    else void doUpload();                // primeiro envio → direto
  }
```

- [ ] **Step 3a: Abrir o fragment e o `<form>`**

Trocar:
```tsx
  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-5">
```
por:
```tsx
  return (
    <>
      <form onSubmit={handleSubmit} className="max-w-xl space-y-5">
```

- [ ] **Step 3b: Fechar o `<form>`, adicionar o `PopupConfirm` e fechar o fragment**

Trocar (o fechamento do componente):
```tsx
    </form>
  );
}
```
por:
```tsx
    </form>

      <PopupConfirm
        open={confirmOpen}
        variant="destructive"
        title="Substituir certificado?"
        description="A troca do certificado afeta a emissão de notas fiscais e os fluxos que dependem dele. Confirme que o novo arquivo (.pfx/.p12) e a senha estão corretos e válidos antes de continuar."
        confirmLabel="Substituir certificado"
        cancelLabel="Cancelar"
        busy={busy}
        onConfirm={doUpload}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
```

> O conteúdo interno do `<form>` (status, input de arquivo, input de senha, botão submit) **não muda**. A indentação dos filhos do form pode ficar levemente desalinhada após embrulhar no fragment — é cosmético e válido; se houver linter/prettier, ele reflui.

- [ ] **Step 4: `tsc` + `vitest`**

Run: `cd balu-next && npx tsc --noEmit && npx vitest run`
Expected: tsc zero erros; vitest 50/50 (nenhuma suíte cobre `CertificadoForm`).

- [ ] **Step 5: Commit**

```bash
git add "balu-next/src/app/(auth)/configuracoes/CertificadoForm.tsx"
git commit -m "feat(cert): confirma antes de substituir certificado (PopupConfirm destructive)

Na substituição (enviadoEm), o submit valida arquivo+senha e abre um modal de
confirmação avisando do impacto; o upload só roda ao confirmar. Primeiro envio
segue direto, sem modal."
```

---

## Verificação final (controlador, ao vivo)

Dev server em `:3000`, empresa de teste (que já tem certificado → botão "Substituir certificado").

1. `/configuracoes?tab=certificado`: o status mostra "Certificado enviado em …" e o botão é "Substituir certificado".
2. **Sem arquivo/senha:** clicar "Substituir" → toast warning, o modal **não** abre.
3. **Com arquivo + senha:** selecionar um `.pfx` de teste + senha → clicar "Substituir" → o `PopupConfirm` aparece (vermelho, com o aviso de impacto).
4. **Cancelar:** modal fecha; confirmar via query que `arquivos_auxiliares` (supabase_file_path/updated_at) **não** mudou — nada foi enviado.
5. **Confirmar:** o upload roda (botão "Processando…"), modal fecha, toast de sucesso/aviso; `arquivos_auxiliares` atualiza com o novo arquivo.
6. (Opcional) Conferir que o primeiro envio não mostra modal exige uma empresa sem certificado; a lógica é guardada por `enviadoEm`.
