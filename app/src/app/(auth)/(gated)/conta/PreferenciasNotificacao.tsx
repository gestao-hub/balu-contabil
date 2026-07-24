// src/app/(auth)/conta/PreferenciasNotificacao.tsx
// @custom — Bloco 1 (Motor de Obrigações + Notificações), Task 9: aba "Notificações"
// da conta — opt-out de e-mail por tipo. O checkbox marcado significa "desativar
// e-mail" para aquele tipo; as notificações no app sempre aparecem, independente
// desta preferência. `abertura_etapa` fica de fora (transacional do Bloco 2).

import { createServerClient } from '@/lib/supabase/server';
import { NOTIFICACAO_TIPOS, TIPOS_VALIDOS } from '@/lib/notifications/tipos';
import { salvarPreferenciasNotificacaoAction } from './actions';

// Wrapper de retorno void — <form action> exige (formData) => void | Promise<void>,
// e salvarPreferenciasNotificacaoAction devolve ContaActionResult.
async function salvarWrapper(fd: FormData): Promise<void> {
  'use server';
  await salvarPreferenciasNotificacaoAction(fd);
}

export default async function PreferenciasNotificacao() {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('notification_preferences')
    .select('tipo,email_enabled');

  const desativados = new Set(
    (data ?? []).filter((r) => !r.email_enabled).map((r) => r.tipo as string),
  );

  const tipos = TIPOS_VALIDOS.filter((t) => t !== 'abertura_etapa');

  return (
    <form action={salvarWrapper} className="max-w-lg space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Notificações por e-mail
        </p>
        <p className="text-sm text-muted-foreground">
          Escolha para quais avisos você quer receber e-mail. As notificações no app aparecem sempre.
        </p>
        <div className="space-y-2">
          {tipos.map((tipo) => (
            <label
              key={tipo}
              className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2"
            >
              <span className="text-sm text-foreground">{NOTIFICACAO_TIPOS[tipo].label}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground-2">
                Desativar e-mail
                <input
                  type="checkbox"
                  name="desativar_email"
                  value={tipo}
                  defaultChecked={desativados.has(tipo)}
                  className="size-4 rounded border-border"
                />
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Salvar preferências
        </button>
      </div>
    </form>
  );
}
