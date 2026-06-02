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
  nome_municipio: string;
  uf: string;
  provedor_nfse: string | null;
  requer_certificado_nfse: boolean | null;
  possui_cancelamento_nfse: boolean | null;
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
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const locked = !editing;

  if (!municipio) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-2 p-6">
        <h2 className="text-sm font-semibold text-muted-foreground-2">NFS-e indisponível</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O município <strong>{cidade || '—'}/{uf || '—'}</strong> não está na base de municípios com NFS-e suportada.
          Confira o endereço na aba "Dados da empresa".
        </p>
      </div>
    );
  }

  const cred = credenciaisDaAutenticacao(municipio);

  function resetFromInitial() {
    setUsuario(initial?.nfse_usuario_login ?? '');
    setSenha(initial?.nfse_senha_login ?? '');
    setToken(initial?.nfse_token_api ?? '');
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
        nfse_usuario_login: cred.login ? (usuario.trim() || null) : null,
        nfse_senha_login: cred.login ? (senha.trim() || null) : null,
        nfse_token_api: cred.token ? (token.trim() || null) : null,
      });
      if (!r.ok) { toast('error', r.error); return; }
      // r.warning vem do best-effort de envio das credenciais pra Focus
      // (Focus 2.2): save local OK mas Focus rejeitou — mostra como warning.
      if (r.warning) toast('warning', r.warning);
      else toast('success', 'Configuração de NFS-e salva.');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      <div className="rounded-lg border border-border bg-surface-2 p-4 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Município (do endereço)</p>
        <p className="mt-1 text-foreground">{municipio.nome_municipio}/{municipio.uf}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-muted-foreground-2">
          <span>Provedor: <strong>{municipio.provedor_nfse ?? '—'}</strong></span>
          <span>Cancelamento via portal: <strong>{municipio.possui_cancelamento_nfse ? 'sim' : 'não'}</strong></span>
        </div>
      </div>

      {/* @deferred — Inscrição municipal foi movida para a aba "Dados da empresa"
          (companies.inscricao_municipal, fonte única). Série RPS e Número RPS inicial
          ficam ocultos até validação; valores preservados em empresas_fiscais porque o
          submit omite esses campos do patch parcial.
          Ver docs/superpowers/specs/2026-05-27-nfse-campos-empresa-design.md */}

      {cred.certificado && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          Este município exige <strong>Certificado Digital A1</strong> — envie na seção acima.
        </p>
      )}

      {(cred.login || cred.token) && (
        <>
          <fieldset className="grid grid-cols-2 gap-4">
            <legend className="text-sm font-semibold text-foreground">Credenciais do município</legend>
            {cred.login && <Field label="Usuário (login)" value={usuario} onChange={setUsuario} disabled={locked} />}
            {cred.login && <Field label="Senha" type="password" value={senha} onChange={setSenha} disabled={locked} />}
            {cred.token && <Field label="Token" value={token} onChange={setToken} disabled={locked} className="col-span-2" />}
          </fieldset>

          <div className="flex justify-end gap-2">
            {editing ? (
              <>
                <button type="button" onClick={handleCancel} disabled={busy} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Salvar</button>
              </>
            ) : (
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"><Pencil className="size-4" />Editar</button>
            )}
          </div>
        </>
      )}
    </form>
  );
}

function Field({ label, value, onChange, type = 'text', disabled = false, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean; className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="text-xs font-medium text-muted-foreground-2">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm disabled:bg-surface-2 disabled:text-muted-foreground"
      />
    </label>
  );
}
