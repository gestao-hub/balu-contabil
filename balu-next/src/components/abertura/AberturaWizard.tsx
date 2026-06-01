// src/components/abertura/AberturaWizard.tsx
'use client';
import { useState } from 'react';
import { EMPTY_ABERTURA, DOC_KEYS, EMPRESA_TIPOS, REGIMES, SEDE_TIPOS,
  type AberturaData, type DocKey } from '@/types/abertura';
import ConfirmacaoEnvioDialog from './ConfirmacaoEnvioDialog';

type StepField =
  | { kind: 'text' | 'date' | 'email' | 'tel'; name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'select'; name: keyof AberturaData; label: string; options: readonly string[]; required?: boolean }
  | { kind: 'csv'; name: 'empresa_cnaes_secundarios'; label: string }
  | { kind: 'checkbox'; name: keyof AberturaData; label: string }
  | { kind: 'cep'; name: keyof AberturaData; label: string };

const STEPS: { title: string; fields: StepField[] }[] = [
  { title: 'Titular', fields: [
    { kind: 'text', name: 'titular_nome_completo', label: 'Nome completo', required: true },
    { kind: 'text', name: 'titular_cpf', label: 'CPF', required: true },
    { kind: 'text', name: 'titular_rg_numero', label: 'RG' },
    { kind: 'text', name: 'titular_rg_orgao_emissor', label: 'Órgão emissor' },
    { kind: 'text', name: 'titular_rg_uf', label: 'UF do RG' },
    { kind: 'date', name: 'titular_data_nascimento', label: 'Data de nascimento' },
    { kind: 'text', name: 'titular_estado_civil', label: 'Estado civil' },
    { kind: 'text', name: 'titular_nome_mae', label: 'Nome da mãe' },
    { kind: 'text', name: 'titular_nacionalidade', label: 'Nacionalidade' },
    { kind: 'tel', name: 'titular_telefone', label: 'Telefone' },
    { kind: 'email', name: 'titular_email', label: 'E-mail' },
    { kind: 'text', name: 'titular_naturalidade_cidade', label: 'Naturalidade (cidade)' },
    { kind: 'text', name: 'titular_naturalidade_uf', label: 'Naturalidade (UF)' },
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
  { title: 'Documentos', fields: [] }, // etapa especial: uploads (DOC_KEYS)
];

export default function AberturaWizard({
  mode, initial, existingDocs, action,
}: {
  mode: 'criar' | 'alterar';
  initial?: AberturaData;
  existingDocs?: Partial<Record<DocKey, string>>;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [data, setData] = useState<AberturaData>(initial ?? EMPTY_ABERTURA);
  const [files, setFiles] = useState<Partial<Record<DocKey, File>>>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  function set<K extends keyof AberturaData>(name: K, value: AberturaData[K]) {
    setData((d) => ({ ...d, [name]: value }));
  }

  // "mesmo que titular": ao marcar, copia o endereço do titular para a sede.
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
    const cep = field === 'titular' ? data.titular_cep : data.sede_cep;
    const { lookupCepAction } = await import('@/app/(auth)/onboarding/actions');
    const res = await lookupCepAction(cep);
    if (res.ok) {
      const c = res.data;
      if (field === 'titular') setData((d) => ({ ...d, titular_logradouro: c.logradouro ?? d.titular_logradouro, titular_bairro: c.bairro ?? d.titular_bairro, titular_cidade: c.municipio ?? d.titular_cidade, titular_uf: c.uf ?? d.titular_uf }));
      else setData((d) => ({ ...d, sede_logradouro: c.logradouro ?? d.sede_logradouro, sede_bairro: c.bairro ?? d.sede_bairro, sede_cidade: c.municipio ?? d.sede_cidade, sede_uf: c.uf ?? d.sede_uf }));
    }
  }

  function next() {
    // validação leve por etapa: campos required preenchidos
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
      fd.append(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    for (const k of DOC_KEYS) { const f = files[k]; if (f) fd.append(k, f); }
    const res = await action(fd);
    setPending(false);
    if (!res.ok) { setConfirm(false); setError(res.error); }
    // sucesso → a action faz redirect; nada a fazer aqui.
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
        {!isLast && STEPS[step].fields.map((f) => (
          <Field key={String(f.name)} f={f} data={data} set={set}
            onCep={f.kind === 'cep' ? () => buscarCep(f.name === 'sede_cep' ? 'sede' : 'titular') : undefined}
            onToggleSede={f.name === 'sede_mesmo_que_titular' ? toggleSedeMesmo : undefined} />
        ))}
        {isLast && DOC_KEYS.map((k) => (
          <label key={k} className="text-sm text-muted-foreground-2">
            {docLabel(k)}
            {existingDocs?.[k] && <span className="ml-2 text-xs text-muted-foreground">(enviado)</span>}
            <input type="file" className="mt-1 block w-full text-sm"
              onChange={(e) => setFiles((s) => ({ ...s, [k]: e.target.files?.[0] }))} />
          </label>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex justify-between">
        <button type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)}
          className="px-4 py-2 text-sm rounded-lg border border-border disabled:opacity-50">Voltar</button>
        {!isLast
          ? <button type="button" onClick={next} className="px-4 py-2 text-sm rounded-lg bg-primary text-white">Avançar</button>
          : <button type="button" onClick={() => setConfirm(true)} className="px-4 py-2 text-sm rounded-lg bg-primary text-white">Enviar</button>}
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

// Renderizador genérico de campo
function Field({ f, data, set, onCep, onToggleSede }: {
  f: StepField;
  data: AberturaData;
  set: <K extends keyof AberturaData>(name: K, value: AberturaData[K]) => void;
  onCep?: () => void;
  onToggleSede?: (checked: boolean) => void;
}) {
  const cls = 'w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary';
  const v = (data as unknown as Record<string, unknown>)[f.name];
  if (f.kind === 'checkbox') return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground-2">
      <input type="checkbox" checked={!!v} onChange={(e) => (onToggleSede ?? ((x: boolean) => set(f.name as keyof AberturaData, x as AberturaData[keyof AberturaData])))(e.target.checked)} /> {f.label}
    </label>
  );
  if (f.kind === 'select') return (
    <label className="text-sm text-muted-foreground-2">{f.label}{'required' in f && f.required && ' *'}
      <select value={String(v ?? '')} onChange={(e) => set(f.name as keyof AberturaData, e.target.value as AberturaData[keyof AberturaData])} className={cls + ' mt-1'}>
        <option value=""></option>
        {(f as Extract<StepField, { kind: 'select' }>).options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
  if (f.kind === 'csv') return (
    <label className="text-sm text-muted-foreground-2 sm:col-span-2">{f.label}
      <input value={(v as string[]).join(', ')} onChange={(e) => set('empresa_cnaes_secundarios', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} className={cls + ' mt-1'} />
    </label>
  );
  if (f.kind === 'cep') return (
    <label className="text-sm text-muted-foreground-2">{f.label}
      <div className="flex gap-2 mt-1">
        <input value={String(v ?? '')} onChange={(e) => set(f.name as keyof AberturaData, e.target.value as AberturaData[keyof AberturaData])} className={cls} />
        <button type="button" onClick={onCep} className="px-3 py-2 text-sm rounded-lg border border-border whitespace-nowrap">Buscar</button>
      </div>
    </label>
  );
  return (
    <label className="text-sm text-muted-foreground-2">{f.label}{'required' in f && f.required && ' *'}
      <input type={f.kind === 'text' ? 'text' : f.kind} value={String(v ?? '')} onChange={(e) => set(f.name as keyof AberturaData, e.target.value as AberturaData[keyof AberturaData])} className={cls + ' mt-1'} />
    </label>
  );
}
