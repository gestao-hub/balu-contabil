'use client';
// 0102 — o admin token da uazapi, na tela em vez da variável de ambiente.
//
// O CAMPO NASCE VAZIO, SEMPRE: o token guardado nunca volta para cá, nem
// mascarado — o `placeholder` é só aviso de que existe um valor. Mesma regra
// dos outros cards de `/admin/configuracoes`.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { salvarAdminTokenAction } from './actions';

export default function AdminTokenForm({ configurado }: { configurado: boolean }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    const v = token.trim();
    if (!v) { setMsg({ tipo: 'erro', texto: 'Cole o admin token da uazapi.' }); return; }
    iniciar(async () => {
      const r = await salvarAdminTokenAction(v);
      if (!r.ok) { setMsg({ tipo: 'erro', texto: r.error }); return; }
      setMsg({
        tipo: 'ok',
        texto: `Token aceito pela uazapi (${r.dados.instancias} instâncias visíveis no servidor) e salvo.`,
      });
      // Some da tela assim que sai daqui: o campo não guarda segredo entre
      // salvamentos, e o próximo "salvar" não deve regravar o mesmo token.
      setToken('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-3 text-sm">
        {configurado
          ? <ShieldCheck className="size-5 shrink-0 text-success" />
          : <ShieldAlert className="size-5 shrink-0 text-alert" />}
        <div>
          <p className="font-medium text-foreground">Admin token da uazapi</p>
          <p className="text-muted-foreground">
            {configurado
              ? 'Cadastrado. É ele que cria as instâncias — do canal da plataforma e do de cada escritório.'
              : 'Ainda não cadastrado. Sem ele nenhum canal de WhatsApp pode ser criado, nem aqui nem no painel do contador.'}
          </p>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground-2">
          <KeyRound className="mr-1 inline size-3.5" />
          Token
        </span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={configurado ? '•••••••• (guardado — deixe em branco para manter)' : 'cole o admin token'}
          autoComplete="off"
          className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
        />
        <span className="text-[11px] text-muted-foreground">
          Ao salvar, o token é testado contra a uazapi antes de ser gravado — se ela recusar,
          nada é salvo.
        </span>
      </label>

      {msg && (
        <p className={msg.tipo === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>{msg.texto}</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pendente}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pendente && <Loader2 className="size-4 animate-spin" />}
          Testar e salvar
        </button>
      </div>
    </form>
  );
}
