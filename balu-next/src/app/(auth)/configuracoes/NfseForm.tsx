'use client';
// @custom — PR 1.5: aba "NFS-e" das Configurações (PRD §8).
// Município vem do endereço (resolvido no server); credenciais conforme o tipo
// de autenticação do município. Mesmo modo leitura/edição das outras abas.
import { useState } from 'react';
import { Loader2, Save, Pencil } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { credenciaisDaAutenticacao } from '@/lib/fiscal/municipio-nfse';
import { upsertEmpresaFiscalAction } from './actions';

export type MunicipioInfo = {
  id: string;
  municipio: string | null;
  estado: string | null;
  provedor: string | null;
  autenticacao: string | null;
  cancelamento: string | null;
  cancelamento_so_portal: boolean | null;
  requer_liberacao_rps: boolean | null;
};

type Initial = {
  nfse_usuario_login?: string | null;
  nfse_senha_login?: string | null;
  nfse_token_api?: string | null;
  nfse_habilitada?: boolean | null;
  empresa_fiscal_ativada?: boolean | null;
};

type Props = {
  initial: Initial | null;
  municipio: MunicipioInfo | null;
  cidade: string;
  uf: string;
};

export default function NfseForm({ initial, municipio, cidade, uf }: Props) {
  const toast = useToast();
  const [usuario, setUsuario] = useState(initial?.nfse_usuario_login ?? '');
  const [senha, setSenha] = useState(initial?.nfse_senha_login ?? '');
  const [token, setToken] = useState(initial?.nfse_token_api ?? '');
  const [ativada, setAtivada] = useState(!!initial?.empresa_fiscal_ativada);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const locked = !editing;

  if (!municipio) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-sm font-semibold text-zinc-700">NFS-e indisponível</h2>
        <p className="mt-1 text-sm text-zinc-500">
          O município <strong>{cidade || '—'}/{uf || '—'}</strong> não está na base de municípios com NFS-e suportada.
          Confira o endereço na aba "Dados da empresa".
        </p>
      </div>
    );
  }

  const cred = credenciaisDaAutenticacao(municipio.autenticacao);

  function resetFromInitial() {
    setUsuario(initial?.nfse_usuario_login ?? '');
    setSenha(initial?.nfse_senha_login ?? '');
    setToken(initial?.nfse_token_api ?? '');
    setAtivada(!!initial?.empresa_fiscal_ativada);
  }

  function handleCancel() {
    resetFromInitial();
    setEditing(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // TS não estreita o prop `municipio` dentro deste closure async (apesar do
    // early-return acima); cópia local garante o narrowing. NÃO remover.
    const mun = municipio;
    if (!mun) return;
    setBusy(true);
    try {
      const r = await upsertEmpresaFiscalAction({
        municipio_id: mun.id,
        nfse_autenticacao_tipo: mun.autenticacao ?? null,
        nfse_usuario_login: cred.login ? (usuario.trim() || null) : null,
        nfse_senha_login: cred.login ? (senha.trim() || null) : null,
        nfse_token_api: cred.token ? (token.trim() || null) : null,
        nfse_habilitada: ativada,         // espelha empresa_fiscal_ativada (v1: toggle único)
        empresa_fiscal_ativada: ativada,
      });
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Configuração de NFS-e salva.');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Município (do endereço)</p>
        <p className="mt-1 text-zinc-800">{municipio.municipio}/{municipio.estado}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-zinc-600">
          <span>Provedor: <strong>{municipio.provedor ?? '—'}</strong></span>
          <span>Autenticação: <strong>{municipio.autenticacao ?? '—'}</strong></span>
          <span>Cancelamento: <strong>{municipio.cancelamento ?? '—'}{municipio.cancelamento_so_portal ? ' (só portal)' : ''}</strong></span>
          <span>Liberação RPS: <strong>{municipio.requer_liberacao_rps ? 'requer' : 'não'}</strong></span>
        </div>
      </div>

      {/* @deferred — Inscrição municipal foi movida para a aba "Dados da empresa"
          (companies.inscricao_municipal, fonte única). Série RPS e Número RPS inicial
          ficam ocultos até validação; valores preservados em empresas_fiscais porque o
          submit omite esses campos do patch parcial.
          Ver docs/superpowers/specs/2026-05-27-nfse-campos-empresa-design.md */}

      {cred.certificado && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          Este município exige <strong>Certificado Digital A1</strong> — configure na aba "Certificado A1".
        </p>
      )}

      {(cred.login || cred.token) && (
        <fieldset className="grid grid-cols-2 gap-4">
          <legend className="text-sm font-semibold text-brand-navy">Credenciais do município</legend>
          {cred.login && <Field label="Usuário (login)" value={usuario} onChange={setUsuario} disabled={locked} />}
          {cred.login && <Field label="Senha" type="password" value={senha} onChange={setSenha} disabled={locked} />}
          {cred.token && <Field label="Token" value={token} onChange={setToken} disabled={locked} className="col-span-2" />}
        </fieldset>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ativada} onChange={(e) => setAtivada(e.target.checked)} disabled={locked} className="size-4 rounded border-zinc-300 disabled:opacity-50" />
        <span className="text-zinc-700">Empresa fiscal ativada (habilita emissão de NFS-e)</span>
      </label>

      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <button type="button" onClick={handleCancel} disabled={busy} className="rounded-md border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Salvar</button>
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"><Pencil className="size-4" />Editar</button>
        )}
      </div>
    </form>
  );
}

function Field({ label, value, onChange, type = 'text', disabled = false, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
      />
    </label>
  );
}
