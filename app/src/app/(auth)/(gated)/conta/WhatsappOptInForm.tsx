// @custom — Bloco 6B (WhatsApp): opt-in de avisos por WhatsApp com feedback de
// erro/sucesso inline via useActionState, mesmo padrão já usado em
// (public)/login/page.tsx (loginAction + useActionState + useFormStatus).
// Antes, o form usava um wrapper `(fd) => { await salvarWhatsappAction(fd); }`
// que descartava o ContaActionResult — número malformado ou já em uso por
// outra conta simplesmente não avisava nada ao usuário.
'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { salvarWhatsappAction } from './actions';

export default function WhatsappOptInForm({
  whatsappNumero,
  whatsappHabilitadoEm,
}: {
  whatsappNumero: string | null;
  whatsappHabilitadoEm: string | null;
}) {
  const [state, formAction] = useActionState(salvarWhatsappAction, undefined);

  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <h3 className="text-sm font-medium text-foreground">WhatsApp</h3>
      <p className="text-xs text-muted-foreground">
        Avisos de vencimento e pendências também por WhatsApp. Você pode desativar quando quiser.
      </p>
      <input
        type="tel"
        name="whatsapp_numero"
        placeholder="+5511999998888"
        defaultValue={whatsappNumero ?? ''}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <label className="flex min-h-6 items-center gap-2 text-sm">
        <input type="checkbox" name="ativar" defaultChecked={!!whatsappHabilitadoEm} />
        Ativar avisos por WhatsApp
      </label>

      {state && !state.ok && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="text-xs text-muted-foreground">{state.message ?? 'Salvo com sucesso.'}</p>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60 transition"
    >
      {pending ? 'Salvando…' : 'Salvar'}
    </button>
  );
}
