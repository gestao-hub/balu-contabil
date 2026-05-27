# Confirmação ao substituir certificado A1 (design)

**Data:** 2026-05-27
**Status:** aprovado (brainstorming) — pronto para writing-plans
**Branch:** `feat/cert-substituir-confirm`
**Fontes:** `CertificadoForm.tsx` (aba Certificado A1, PR 1.6), `PopupConfirm.tsx` (componente de confirmação reutilizável).

## Contexto

Na aba "Certificado A1", o `CertificadoForm` sobe o certificado direto no submit. Quando já existe um certificado (`enviadoEm` preenchido), o botão vira "Substituir certificado" — e a troca afeta a emissão de notas e os fluxos que dependem do certificado (processamento via n8n, etc.). O usuário quer um **modal de confirmação** antes da substituição, alertando do impacto, para garantir que o novo certificado é válido.

O componente `PopupConfirm` já existe e cobre o caso: props `open`, `title`, `description`, `confirmLabel`, `cancelLabel`, `variant` ('primary' | 'destructive'), `onConfirm` (async, com `busy`), `onCancel`, `busy`.

## Decisões aprovadas

1. **Reusar o `PopupConfirm`** (não criar modal próprio).
2. **Confirmação só na substituição** (`enviadoEm` preenchido). O **primeiro envio** (sem certificado) sobe direto, sem modal — não há nada a impactar.
3. **`variant="destructive"`** (ícone de alerta vermelho) para comunicar cautela.
4. Validação de arquivo+senha acontece **antes** de abrir o modal (não faz sentido confirmar sem arquivo/senha).
5. Sem mudança em action, schema ou storage — só UI.

## Escopo

- `src/app/(auth)/configuracoes/CertificadoForm.tsx`:
  - Importar `PopupConfirm` de `@/components/PopupConfirm`.
  - Novo state `const [confirmOpen, setConfirmOpen] = useState(false);`.
  - Extrair o upload atual (corpo do `try/finally` de hoje) numa função `doUpload()`.
  - `handleSubmit`: valida arquivo+senha (igual hoje); se `enviadoEm` → `setConfirmOpen(true)`; senão → `void doUpload()`.
  - Renderizar `<PopupConfirm>` após o `<form>` (envolver o retorno num fragment `<>…</>`).

### Fora de escopo
- Mudanças no `uploadCertificadoAction`, no schema ou no storage.
- Confirmação no primeiro envio (sem certificado).
- Validar a validade criptográfica do `.pfx` no client (continua sendo só extensão/tamanho/senha não-vazia, como na PR 1.6) — o modal é um aviso ao usuário, não uma validação técnica nova.

## Arquitetura

### `CertificadoForm.tsx`

Estrutura final:

```tsx
'use client';
import { useRef, useState } from 'react';
import { Loader2, Upload, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { uploadCertificadoAction } from './actions';

export default function CertificadoForm({ enviadoEm }: { enviadoEm: string | null }) {
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

  return (
    <>
      <form onSubmit={handleSubmit} className="max-w-xl space-y-5">
        {/* …conteúdo atual inalterado: status, input de arquivo, senha, botão submit… */}
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

O conteúdo do `<form>` (status, input de arquivo, input de senha, botão submit com label "Enviar"/"Substituir") **não muda** — só o `handleSubmit` deixa de subir direto na substituição.

## Fluxo de dados

- **Primeiro envio:** submit → valida → `doUpload()` → `uploadCertificadoAction` → toast.
- **Substituição:** submit → valida → `setConfirmOpen(true)` → `PopupConfirm` → usuário confirma → `doUpload()` → `uploadCertificadoAction` → toast + fecha modal; ou cancela → `setConfirmOpen(false)` (form preservado).

## Tratamento de erro

- Sem arquivo/senha: toast warning, não abre o modal (igual hoje).
- Falha do upload (`!r.ok`): toast de erro; `finally` fecha o modal; form preservado (arquivo+senha) para nova tentativa.
- `warning` (n8n falhou): toast de aviso, certificado salvo (comportamento da PR 1.6 mantido).

## Verificação

- `tsc --noEmit` zero erros; `vitest run` segue verde (nenhum teste cobre `CertificadoForm`).
- UI/manual na empresa de teste (que já tem certificado → botão "Substituir certificado"):
  - Sem arquivo/senha: clicar "Substituir" → toast warning, modal NÃO abre.
  - Com arquivo+senha: clicar "Substituir" → modal de confirmação aparece (vermelho, com o aviso).
  - **Cancelar** → modal fecha, nada é enviado (confirmar via query que `arquivos_auxiliares` não mudou).
  - **Confirmar** → upload roda (botão "Processando…"), modal fecha, toast de sucesso/aviso; novo certificado registrado.

## Premissas / fora de escopo

- O modal é um aviso de UX ao usuário; não adiciona validação criptográfica do `.pfx`.
- `PopupConfirm` usa `aria-labelledby="popup-confirm-title"` (id fixo) — só uma instância monta por vez nesta tela; o tema de id duplicado entre múltiplos PopupConfirm é pré-existente e fora deste escopo.
