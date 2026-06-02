// src/components/abertura/ConfirmacaoEnvioDialog.tsx
'use client';

export default function ConfirmacaoEnvioDialog({
  open, mode, pending, onConfirm, onCancel,
}: {
  open: boolean;
  mode: 'criar' | 'alterar';
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const msg = mode === 'criar'
    ? 'Atenção: após o envio, as informações só poderão ser alteradas mediante solicitação de alteração. Deseja enviar a solicitação de abertura?'
    : 'Sua solicitação de alteração será enviada para análise. Deseja continuar?';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-surface rounded-2xl border border-border p-6 max-w-md w-full">
        <h2 className="font-semibold text-foreground mb-2">Confirmar envio</h2>
        <p className="text-sm text-muted-foreground mb-6">{msg}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={pending}
            className="px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-surface-2 disabled:opacity-60">
            Cancelar
          </button>
          <button type="button" onClick={onConfirm} disabled={pending}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-60">
            {pending ? 'Enviando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
