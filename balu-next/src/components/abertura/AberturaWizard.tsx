// src/components/abertura/AberturaWizard.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EMPTY_ABERTURA, DOC_KEYS, EMPRESA_TIPOS, REGIMES, SEDE_TIPOS,
  type AberturaData, type DocKey } from '@/types/abertura';
import { lookupCepAction } from '@/app/(auth)/onboarding/actions';
import ConfirmacaoEnvioDialog from './ConfirmacaoEnvioDialog';

type StepField =
  | { kind: 'text' | 'email' | 'tel'; name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'cpf'; name: 'titular_cpf'; label: string; required?: boolean }
  | { kind: 'date'; name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'select'; name: keyof AberturaData; label: string; options: readonly string[]; required?: boolean }
  | { kind: 'csv'; name: 'empresa_cnaes_secundarios'; label: string }
  | { kind: 'checkbox'; name: keyof AberturaData; label: string }
  | { kind: 'cep'; name: keyof AberturaData; label: string };

const STEPS: { title: string; fields: StepField[] }[] = [
  { title: 'Titular', fields: [
    { kind: 'text', name: 'titular_nome_completo', label: 'Nome completo', required: true },
    { kind: 'cpf', name: 'titular_cpf', label: 'CPF', required: true },
    { kind: 'text', name: 'titular_rg_numero', label: 'RG' },
    { kind: 'text', name: 'titular_rg_orgao_emissor', label: 'Órgão emissor' },
    { kind: 'text', name: 'titular_rg_uf', label: 'UF do RG' },
    { kind: 'date', name: 'titular_data_nascimento', label: 'Data de nascimento' },
    { kind: 'text', name: 'titular_estado_civil', label: 'Estado civil' },
    { kind: 'text', name: 'titular_nome_mae', label: 'Nome da mãe' },
    { kind: 'text', name: 'titular_nacionalidade', label: 'Nacionalidade' },
    { kind: 'tel', name: 'titular_telefone', label: 'Telefone' },
    { kind: 'email', name: 'titular_email', label: 'E-mail' },
    { kind: 'text', name: 'titular_naturalidade_cidade', label: 'Naturalidade' },
    { kind: 'text', name: 'titular_naturalidade_uf', label: 'UF da naturalidade' },
  ]},
  { title: 'Endereço do titular', fields: [
    { kind: 'cep', name: 'titular_cep', label: 'CEP' },
    { kind: 'text', name: 'titular_logradouro', label: 'Logradouro' },
    { kind: 'text', name: 'titular_numero', label: 'Número' },
    { kind: 'text', name: 'titular_complemento', label: 'Complemento' },
    { kind: 'text', name: 'titular_bairro', label: 'Bairro' },
    { kind: 'text', name: 'titular_cidade', label: 'Cidade' },
    { kind: 'text', name: 'titular_uf', label: 'UF' },
  ]},
  { title: 'Empresa pretendida', fields: [
    { kind: 'text', name: 'empresa_razao_social_1', label: 'Razão social (opção 1)', required: true },
    { kind: 'text', name: 'empresa_razao_social_2', label: 'Razão social (opção 2)' },
    { kind: 'text', name: 'empresa_razao_social_3', label: 'Razão social (opção 3)' },
    { kind: 'text', name: 'empresa_nome_fantasia', label: 'Nome fantasia' },
    { kind: 'select', name: 'empresa_tipo', label: 'Tipo', options: EMPRESA_TIPOS, required: true },
    { kind: 'text', name: 'empresa_capital_social', label: 'Capital social (R$)' },
    { kind: 'text', name: 'empresa_objeto_social', label: 'Objeto social' },
    { kind: 'text', name: 'empresa_cnae_principal', label: 'CNAE principal (código)' },
    { kind: 'csv', name: 'empresa_cnaes_secundarios', label: 'CNAEs secundários (separados por vírgula)' },
    { kind: 'select', name: 'empresa_regime_tributario', label: 'Regime tributário', options: REGIMES, required: true },
  ]},
  { title: 'Sede', fields: [
    { kind: 'checkbox', name: 'sede_mesmo_que_titular', label: 'Mesmo endereço do titular' },
    { kind: 'select', name: 'sede_tipo_endereco', label: 'Tipo de endereço', options: SEDE_TIPOS, required: true },
    { kind: 'cep', name: 'sede_cep', label: 'CEP' },
    { kind: 'text', name: 'sede_logradouro', label: 'Logradouro' },
    { kind: 'text', name: 'sede_numero', label: 'Número' },
    { kind: 'text', name: 'sede_complemento', label: 'Complemento' },
    { kind: 'text', name: 'sede_bairro', label: 'Bairro' },
    { kind: 'text', name: 'sede_cidade', label: 'Cidade' },
    { kind: 'text', name: 'sede_uf', label: 'UF' },
  ]},
  { title: 'Documentos', fields: [] },
];

// Aplica máscara de CPF: 000.000.000-00
function maskCpf(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

// Aplica máscara de CEP: 00000-000
function maskCep(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d.replace(/^(\d{5})(\d)/, '$1-$2');
}

// Converte DD/MM/AAAA para YYYY-MM-DD (armazenamento)
function dateDisplayToIso(v: string): string {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

// Converte YYYY-MM-DD para DD/MM/AAAA (exibição)
function dateIsoToDisplay(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

// Aplica máscara de data BR: DD/MM/AAAA
function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d
    .replace(/^(\d{2})(\d)/, '$1/$2')
    .replace(/^(\d{2})\/(\d{2})(\d)/, '$1/$2/$3');
}

export default function AberturaWizard({
  mode, initial, existingDocs, action,
}: {
  mode: 'criar' | 'alterar';
  initial?: AberturaData;
  existingDocs?: Partial<Record<DocKey, string>>;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [data, setData] = useState<AberturaData>(() => {
    if (!initial) return EMPTY_ABERTURA;
    // Converte data ISO para exibição BR ao carregar dados existentes
    return {
      ...initial,
      titular_data_nascimento: initial.titular_data_nascimento
        ? dateIsoToDisplay(initial.titular_data_nascimento)
        : '',
    };
  });
  const [files, setFiles] = useState<Partial<Record<DocKey, File>>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  function set<K extends keyof AberturaData>(name: K, value: AberturaData[K]) {
    setData((d) => ({ ...d, [name]: value }));
  }

  function toggleSedeMesmo(checked: boolean) {
    set('sede_mesmo_que_titular', checked);
    if (checked) {
      setData((d) => ({ ...d,
        sede_cep: d.titular_cep, sede_logradouro: d.titular_logradouro, sede_numero: d.titular_numero,
        sede_complemento: d.titular_complemento, sede_bairro: d.titular_bairro,
        sede_cidade: d.titular_cidade, sede_uf: d.titular_uf }));
    }
  }

  async function buscarCep(field: 'titular' | 'sede') {
    // Passa somente dígitos para a action (ela normaliza internamente)
    const raw = field === 'titular' ? data.titular_cep : data.sede_cep;
    const res = await lookupCepAction(raw);
    if (res.ok) {
      const c = res.data;
      if (field === 'titular') {
        setData((d) => ({
          ...d,
          titular_logradouro: c.logradouro ?? d.titular_logradouro,
          titular_bairro: c.bairro ?? d.titular_bairro,
          titular_cidade: c.municipio ?? d.titular_cidade,
          titular_uf: c.uf ?? d.titular_uf,
        }));
      } else {
        setData((d) => ({
          ...d,
          sede_logradouro: c.logradouro ?? d.sede_logradouro,
          sede_bairro: c.bairro ?? d.sede_bairro,
          sede_cidade: c.municipio ?? d.sede_cidade,
          sede_uf: c.uf ?? d.sede_uf,
        }));
      }
    } else {
      setError(res.error);
    }
  }

  function back() {
    if (step === 0) {
      router.push('/onboarding');
    } else {
      setStep((s) => s - 1);
    }
  }

  function next() {
    const required = STEPS[step].fields.filter((f) => 'required' in f && f.required);
    for (const f of required) {
      if (!String((data as unknown as Record<string, unknown>)[f.name] ?? '').trim()) {
        setError(`Preencha: ${f.label}`); return;
      }
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function doSubmit() {
    setPending(true); setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) {
      let val = Array.isArray(v) ? v.join(',') : String(v);
      // Converte data de exibição BR (DD/MM/AAAA) para ISO (YYYY-MM-DD) antes de enviar
      if (k === 'titular_data_nascimento') val = dateDisplayToIso(val);
      // Remove máscara do CPF
      if (k === 'titular_cpf') val = val.replace(/\D/g, '');
      // Remove máscara do CEP
      if (k === 'titular_cep' || k === 'sede_cep') val = val.replace(/\D/g, '');
      fd.append(k, val);
    }
    for (const k of DOC_KEYS) { const f = files[k]; if (f) fd.append(k, f); }
    const res = await action(fd);
    setPending(false);
    if (!res.ok) { setConfirm(false); setError(res.error); }
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="w-full max-w-2xl bg-surface rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-semibold text-foreground">
          {mode === 'criar' ? 'Abertura de empresa' : 'Solicitar alteração'} — {STEPS[step].title}
        </h1>
        <span className="text-xs text-muted-foreground">Etapa {step + 1}/{STEPS.length}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {!isLast && STEPS[step].fields.map((f) => {
          const sedeLocked =
            data.sede_mesmo_que_titular &&
            typeof f.name === 'string' &&
            f.name.startsWith('sede_') &&
            f.name !== 'sede_mesmo_que_titular' &&
            f.name !== 'sede_tipo_endereco';
          return (
            <Field key={String(f.name)} f={f} data={data} set={set} disabled={sedeLocked}
              onCep={f.kind === 'cep' ? () => buscarCep(f.name === 'sede_cep' ? 'sede' : 'titular') : undefined}
              onToggleSede={f.name === 'sede_mesmo_que_titular' ? toggleSedeMesmo : undefined} />
          );
        })}
        {isLast && DOC_KEYS.map((k) => (
          <label key={k} className="text-sm text-muted-foreground-2">
            {docLabel(k)}
            {existingDocs?.[k] && <span className="ml-2 text-xs text-muted-foreground">(enviado)</span>}
            <input type="file" accept="image/*,.pdf" className="mt-1 block w-full text-sm"
              onChange={(e) => setFiles((s) => ({ ...s, [k]: e.target.files?.[0] }))} />
          </label>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex justify-between">
        <button type="button" onClick={back}
          className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-2">
          {step === 0 ? '← Seleção' : 'Voltar'}
        </button>
        {!isLast
          ? <button type="button" onClick={next} className="px-4 py-2 text-sm rounded-lg bg-primary text-white">Avançar</button>
          : <button type="button" disabled={pending} onClick={() => setConfirm(true)} className="px-4 py-2 text-sm rounded-lg bg-primary text-white disabled:opacity-60">Enviar</button>}
      </div>

      <ConfirmacaoEnvioDialog open={confirm} mode={mode} pending={pending}
        onConfirm={doSubmit} onCancel={() => setConfirm(false)} />
    </div>
  );
}

function docLabel(k: DocKey): string {
  const map: Record<DocKey, string> = {
    doc_rg_frente: 'RG (frente)', doc_rg_verso: 'RG (verso)', doc_cnh_frente: 'CNH (frente)',
    doc_cnh_verso: 'CNH (verso)', doc_cpf: 'CPF', doc_comprovante_titular: 'Comprovante (titular)',
    doc_comprovante_sede: 'Comprovante (sede)', doc_declaracao_uso: 'Declaração de uso',
  };
  return map[k];
}

function Field({ f, data, set, onCep, onToggleSede, disabled }: {
  f: StepField;
  data: AberturaData;
  set: <K extends keyof AberturaData>(name: K, value: AberturaData[K]) => void;
  onCep?: () => void;
  onToggleSede?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const cls = 'w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed';
  const v = (data as unknown as Record<string, unknown>)[f.name];

  if (f.kind === 'checkbox') return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground-2">
      <input type="checkbox" checked={!!v}
        onChange={(e) => (onToggleSede ?? ((x: boolean) => set(f.name as keyof AberturaData, x as AberturaData[keyof AberturaData])))(e.target.checked)} />
      {f.label}
    </label>
  );

  if (f.kind === 'select') return (
    <label className="text-sm text-muted-foreground-2">{f.label}{'required' in f && f.required && ' *'}
      <select value={String(v ?? '')} disabled={disabled}
        onChange={(e) => set(f.name as keyof AberturaData, e.target.value as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'}>
        <option value=""></option>
        {(f as Extract<StepField, { kind: 'select' }>).options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  if (f.kind === 'csv') return (
    <label className="text-sm text-muted-foreground-2 sm:col-span-2">{f.label}
      <input disabled={disabled} value={(v as string[]).join(', ')}
        onChange={(e) => set('empresa_cnaes_secundarios', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        className={cls + ' mt-1'} />
    </label>
  );

  if (f.kind === 'cpf') return (
    <label className="text-sm text-muted-foreground-2">{f.label}{'required' in f && f.required && ' *'}
      <input type="text" disabled={disabled} value={String(v ?? '')} placeholder="000.000.000-00"
        onChange={(e) => set('titular_cpf', maskCpf(e.target.value) as AberturaData['titular_cpf'])}
        className={cls + ' mt-1'} maxLength={14} />
    </label>
  );

  if (f.kind === 'cep') return (
    <label className="text-sm text-muted-foreground-2">{f.label}
      <div className="flex gap-2 mt-1">
        <input disabled={disabled} value={String(v ?? '')} placeholder="00000-000"
          onChange={(e) => set(f.name as keyof AberturaData, maskCep(e.target.value) as AberturaData[keyof AberturaData])}
          className={cls} maxLength={9} />
        <button type="button" disabled={disabled} onClick={onCep}
          className="px-3 py-2 text-sm rounded-lg border border-border whitespace-nowrap disabled:opacity-50">Buscar</button>
      </div>
    </label>
  );

  // date: usa text com máscara DD/MM/AAAA (evita formato americano do input[type=date])
  if (f.kind === 'date') return (
    <label className="text-sm text-muted-foreground-2">{f.label}{'required' in f && f.required && ' *'}
      <input type="text" disabled={disabled} value={String(v ?? '')} placeholder="DD/MM/AAAA"
        onChange={(e) => set(f.name as keyof AberturaData, maskDate(e.target.value) as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} maxLength={10} />
    </label>
  );

  return (
    <label className="text-sm text-muted-foreground-2">{f.label}{'required' in f && f.required && ' *'}
      <input disabled={disabled} type={f.kind === 'text' ? 'text' : f.kind} value={String(v ?? '')}
        onChange={(e) => set(f.name as keyof AberturaData, e.target.value as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );
}
