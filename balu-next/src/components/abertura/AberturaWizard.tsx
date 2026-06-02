// src/components/abertura/AberturaWizard.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { EMPTY_ABERTURA, DOC_KEYS, EMPRESA_TIPOS, REGIMES, SEDE_TIPOS,
  type AberturaData, type DocKey } from '@/types/abertura';
import { lookupCepAction } from '@/app/(auth)/onboarding/actions';
import { formatCpf, formatCep, formatTel } from '@/lib/format/masks';
import ConfirmacaoEnvioDialog from './ConfirmacaoEnvioDialog';

// ─── Constantes ──────────────────────────────────────────────────────────────

const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const;

const ESTADO_CIVIL_OPTIONS = [
  'Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União estável', 'Separado(a)',
] as const;

const ORGAO_EMISSOR_OPTIONS = [
  'SSP', 'DETRAN', 'PM', 'SESP', 'PC', 'CNH', 'CRM', 'CRO', 'OAB', 'Outro',
] as const;

// ─── Tipos de campo ───────────────────────────────────────────────────────────

type StepField =
  | { kind: 'text';     name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'alpha';    name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'digits';   name: keyof AberturaData; label: string; required?: boolean; maxLen?: number }
  | { kind: 'decimal';  name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'cpf';      name: 'titular_cpf';      label: string; required?: boolean }
  | { kind: 'date';     name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'email';    name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'tel';      name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'uf';       name: keyof AberturaData; label: string; required?: boolean }
  | { kind: 'select';   name: keyof AberturaData; label: string; options: readonly string[]; required?: boolean }
  | { kind: 'csv';      name: 'empresa_cnaes_secundarios'; label: string }
  | { kind: 'checkbox'; name: keyof AberturaData; label: string }
  | { kind: 'cep';      name: keyof AberturaData; label: string };

// ─── Etapas ───────────────────────────────────────────────────────────────────

const STEPS: { title: string; fields: StepField[] }[] = [
  { title: 'Titular', fields: [
    { kind: 'alpha',  name: 'titular_nome_completo',   label: 'Nome completo', required: true },
    { kind: 'cpf',    name: 'titular_cpf',             label: 'CPF', required: true },
    { kind: 'digits', name: 'titular_rg_numero',       label: 'RG' },
    { kind: 'select', name: 'titular_rg_orgao_emissor',label: 'Órgão emissor do RG', options: ORGAO_EMISSOR_OPTIONS },
    { kind: 'uf',     name: 'titular_rg_uf',           label: 'UF do RG' },
    { kind: 'date',   name: 'titular_data_nascimento', label: 'Data de nascimento' },
    { kind: 'select', name: 'titular_estado_civil',    label: 'Estado civil', options: ESTADO_CIVIL_OPTIONS },
    { kind: 'alpha',  name: 'titular_nome_mae',        label: 'Nome da mãe' },
    { kind: 'alpha',  name: 'titular_nacionalidade',   label: 'Nacionalidade' },
    { kind: 'tel',    name: 'titular_telefone',        label: 'Telefone' },
    { kind: 'email',  name: 'titular_email',           label: 'E-mail' },
    { kind: 'alpha',  name: 'titular_naturalidade_cidade', label: 'Naturalidade (cidade)' },
    { kind: 'uf',     name: 'titular_naturalidade_uf', label: 'UF da naturalidade' },
  ]},
  { title: 'Endereço do titular', fields: [
    { kind: 'cep',  name: 'titular_cep',        label: 'CEP' },
    { kind: 'text', name: 'titular_logradouro', label: 'Logradouro' },
    { kind: 'text', name: 'titular_numero',     label: 'Número' },
    { kind: 'text', name: 'titular_complemento',label: 'Complemento' },
    { kind: 'text', name: 'titular_bairro',     label: 'Bairro' },
    { kind: 'text', name: 'titular_cidade',     label: 'Cidade' },
    { kind: 'uf',   name: 'titular_uf',         label: 'UF' },
  ]},
  { title: 'Empresa pretendida', fields: [
    { kind: 'text',    name: 'empresa_razao_social_1',     label: 'Razão social (opção 1)', required: true },
    { kind: 'text',    name: 'empresa_razao_social_2',     label: 'Razão social (opção 2)' },
    { kind: 'text',    name: 'empresa_razao_social_3',     label: 'Razão social (opção 3)' },
    { kind: 'text',    name: 'empresa_nome_fantasia',      label: 'Nome fantasia' },
    { kind: 'select',  name: 'empresa_tipo',               label: 'Tipo', options: EMPRESA_TIPOS, required: true },
    { kind: 'decimal', name: 'empresa_capital_social',     label: 'Capital social (R$)' },
    { kind: 'text',    name: 'empresa_objeto_social',      label: 'Objeto social' },
    { kind: 'digits',  name: 'empresa_cnae_principal',     label: 'CNAE principal', maxLen: 7 },
    { kind: 'csv',     name: 'empresa_cnaes_secundarios',  label: 'CNAEs secundários (separados por vírgula)' },
    { kind: 'select',  name: 'empresa_regime_tributario',  label: 'Regime tributário', options: REGIMES, required: true },
  ]},
  { title: 'Sede', fields: [
    { kind: 'checkbox', name: 'sede_mesmo_que_titular', label: 'Mesmo endereço do titular' },
    { kind: 'select',   name: 'sede_tipo_endereco',     label: 'Tipo de endereço', options: SEDE_TIPOS, required: true },
    { kind: 'cep',  name: 'sede_cep',        label: 'CEP' },
    { kind: 'text', name: 'sede_logradouro', label: 'Logradouro' },
    { kind: 'text', name: 'sede_numero',     label: 'Número' },
    { kind: 'text', name: 'sede_complemento',label: 'Complemento' },
    { kind: 'text', name: 'sede_bairro',     label: 'Bairro' },
    { kind: 'text', name: 'sede_cidade',     label: 'Cidade' },
    { kind: 'uf',   name: 'sede_uf',         label: 'UF' },
  ]},
  { title: 'Documentos', fields: [] },
];

// ─── Funções de máscara / normalização ───────────────────────────────────────

// formatCpf, formatCep e formatTel vêm de @/lib/format/masks
const maskCpf = formatCpf;
const maskCep = formatCep;

function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d
    .replace(/^(\d{2})(\d)/, '$1/$2')
    .replace(/^(\d{2})\/(\d{2})(\d)/, '$1/$2/$3');
}

const maskTel = formatTel;

function maskDecimal(raw: string): string {
  // Permite dígitos, vírgula e ponto
  return raw.replace(/[^\d.,]/g, '');
}

function onlyAlpha(raw: string): string {
  // Permite letras (incluindo acentuadas), espaços e hífen
  return raw.replace(/[^a-zA-ZÀ-ÿ\s-]/g, '');
}

function onlyDigits(raw: string, maxLen?: number): string {
  const d = raw.replace(/\D/g, '');
  return maxLen ? d.slice(0, maxLen) : d;
}

function dateDisplayToIso(v: string): string {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

function dateIsoToDisplay(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AberturaWizard({
  mode, initial, existingDocs, action, onBack, naked = false,
}: {
  mode: 'criar' | 'alterar';
  initial?: AberturaData;
  existingDocs?: Partial<Record<DocKey, string>>;
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Sobrescreve o comportamento do botão Voltar na etapa 0 (ex.: fechar um popup). */
  onBack?: () => void;
  /** Remove borda/bg/rounded — para uso dentro de um popup que já fornece o card. */
  naked?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<AberturaData>(() => {
    const base = initial ?? EMPTY_ABERTURA;
    return {
      ...base,
      // Aplica máscaras nos campos que vêm do banco como dígitos crus
      titular_cpf:      maskCpf(base.titular_cpf),
      titular_cep:      maskCep(base.titular_cep),
      sede_cep:         maskCep(base.sede_cep),
      titular_telefone: maskTel(base.titular_telefone),
      titular_data_nascimento: base.titular_data_nascimento
        ? dateIsoToDisplay(base.titular_data_nascimento)
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
      setData((d) => ({
        ...d,
        sede_cep: d.titular_cep, sede_logradouro: d.titular_logradouro,
        sede_numero: d.titular_numero, sede_complemento: d.titular_complemento,
        sede_bairro: d.titular_bairro, sede_cidade: d.titular_cidade, sede_uf: d.titular_uf,
      }));
    }
  }

  async function buscarCep(field: 'titular' | 'sede') {
    setError(null);
    const raw = field === 'titular' ? data.titular_cep : data.sede_cep;
    const res = await lookupCepAction(raw);
    if (res.ok) {
      const c = res.data;
      if (field === 'titular') {
        setData((d) => ({
          ...d,
          titular_logradouro: c.logradouro ?? d.titular_logradouro,
          titular_bairro:     c.bairro ?? d.titular_bairro,
          titular_cidade:     c.municipio ?? d.titular_cidade,
          titular_uf:         c.uf ?? d.titular_uf,
        }));
      } else {
        setData((d) => ({
          ...d,
          sede_logradouro: c.logradouro ?? d.sede_logradouro,
          sede_bairro:     c.bairro ?? d.sede_bairro,
          sede_cidade:     c.municipio ?? d.sede_cidade,
          sede_uf:         c.uf ?? d.sede_uf,
        }));
      }
    } else {
      setError(res.error);
    }
  }

  function back() {
    if (step === 0) {
      if (onBack) onBack();
      else router.push('/onboarding');
    } else {
      setError(null); setStep((s) => s - 1);
    }
  }

  function next() {
    const stepFields = STEPS[step].fields;

    // Validação de required
    const required = stepFields.filter((f) => 'required' in f && f.required);
    for (const f of required) {
      if (!String((data as unknown as Record<string, unknown>)[f.name] ?? '').trim()) {
        setError(`Preencha: ${f.label}`); return;
      }
    }

    // Validação de e-mail (se preenchido)
    const emailField = stepFields.find((f) => f.kind === 'email');
    if (emailField) {
      const val = String((data as unknown as Record<string, unknown>)[emailField.name] ?? '').trim();
      if (val && !isValidEmail(val)) { setError('E-mail inválido.'); return; }
    }

    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function doSubmit() {
    setPending(true); setError(null);
    const fd = new FormData();
    for (const [k, v] of Object.entries(data)) {
      let val = Array.isArray(v) ? v.join(',') : String(v);
      if (k === 'titular_data_nascimento') val = dateDisplayToIso(val);
      if (k === 'titular_cpf') val = val.replace(/\D/g, '');
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
    <div className={`w-full max-w-2xl ${naked ? '' : 'bg-surface rounded-2xl border border-border p-6'}`}>
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
        {/* Oculta o botão no step 0 quando não há onBack (ex: popup sem navegação de volta) */}
        {(step > 0 || onBack) ? (
          <button type="button" onClick={back}
            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-surface-2">
            {step === 0 ? '← Seleção' : 'Voltar'}
          </button>
        ) : <span />}
        {!isLast
          ? <button type="button" onClick={next}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white">Avançar</button>
          : <button type="button" disabled={pending} onClick={() => setConfirm(true)}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white disabled:opacity-60">Enviar</button>}
      </div>

      <ConfirmacaoEnvioDialog open={confirm} mode={mode} pending={pending}
        onConfirm={doSubmit} onCancel={() => setConfirm(false)} />
    </div>
  );
}

// ─── Labels de documentos ─────────────────────────────────────────────────────

function docLabel(k: DocKey): string {
  const map: Record<DocKey, string> = {
    doc_rg_frente:          'RG (frente)',
    doc_rg_verso:           'RG (verso)',
    doc_cnh_frente:         'CNH (frente)',
    doc_cnh_verso:          'CNH (verso)',
    doc_cpf:                'CPF',
    doc_comprovante_titular:'Comprovante endereço (titular)',
    doc_comprovante_sede:   'Comprovante endereço (sede)',
    doc_declaracao_uso:     'Declaração de uso do endereço',
  };
  return map[k];
}

// ─── Renderizador de campo ────────────────────────────────────────────────────

const cls = 'w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed';

function Field({ f, data, set, onCep, onToggleSede, disabled }: {
  f: StepField;
  data: AberturaData;
  set: <K extends keyof AberturaData>(name: K, value: AberturaData[K]) => void;
  onCep?: () => void;
  onToggleSede?: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const v = (data as unknown as Record<string, unknown>)[f.name];
  const label = (
    <>{f.kind !== 'checkbox' && (f as { label: string }).label}
    {'required' in f && f.required && ' *'}</>
  );

  if (f.kind === 'checkbox') return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground-2 sm:col-span-2">
      <input type="checkbox" checked={!!v}
        onChange={(e) => (onToggleSede ?? ((x: boolean) =>
          set(f.name as keyof AberturaData, x as AberturaData[keyof AberturaData])))(e.target.checked)} />
      {f.label}
    </label>
  );

  if (f.kind === 'uf') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <select value={String(v ?? '')} disabled={disabled}
        onChange={(e) => set(f.name as keyof AberturaData, e.target.value as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'}>
        <option value=""></option>
        {UF_OPTIONS.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
      </select>
    </label>
  );

  if (f.kind === 'select') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <select value={String(v ?? '')} disabled={disabled}
        onChange={(e) => set(f.name as keyof AberturaData, e.target.value as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'}>
        <option value=""></option>
        {(f as Extract<StepField, { kind: 'select' }>).options.map((o: string) =>
          <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  if (f.kind === 'csv') return (
    <label className="text-sm text-muted-foreground-2 sm:col-span-2">{label}
      <input disabled={disabled} value={(v as string[]).join(', ')} className={cls + ' mt-1'}
        onChange={(e) => set('empresa_cnaes_secundarios',
          e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
    </label>
  );

  if (f.kind === 'cpf') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="text" disabled={disabled} value={maskCpf(String(v ?? ''))}
        placeholder="000.000.000-00" maxLength={14}
        onChange={(e) => set('titular_cpf', maskCpf(e.target.value) as AberturaData['titular_cpf'])}
        className={cls + ' mt-1'} />
    </label>
  );

  if (f.kind === 'cep') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <div className="flex gap-2 mt-1">
        <input disabled={disabled} value={maskCep(String(v ?? ''))} placeholder="00000-000" maxLength={9}
          onChange={(e) => set(f.name as keyof AberturaData,
            maskCep(e.target.value) as AberturaData[keyof AberturaData])}
          className={cls} />
        <button type="button" disabled={disabled} onClick={onCep}
          className="px-3 py-2 text-sm rounded-lg border border-border whitespace-nowrap disabled:opacity-50">
          Buscar
        </button>
      </div>
    </label>
  );

  if (f.kind === 'date') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="text" disabled={disabled} value={String(v ?? '')}
        placeholder="DD/MM/AAAA" maxLength={10}
        onChange={(e) => set(f.name as keyof AberturaData,
          maskDate(e.target.value) as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );

  if (f.kind === 'alpha') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="text" disabled={disabled} value={String(v ?? '')}
        onChange={(e) => set(f.name as keyof AberturaData,
          onlyAlpha(e.target.value) as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );

  if (f.kind === 'digits') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="text" inputMode="numeric" disabled={disabled} value={String(v ?? '')}
        maxLength={'maxLen' in f ? f.maxLen : undefined}
        onChange={(e) => set(f.name as keyof AberturaData,
          onlyDigits(e.target.value, 'maxLen' in f ? f.maxLen : undefined) as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );

  if (f.kind === 'decimal') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="text" inputMode="decimal" disabled={disabled} value={String(v ?? '')}
        placeholder="0,00"
        onChange={(e) => set(f.name as keyof AberturaData,
          maskDecimal(e.target.value) as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );

  if (f.kind === 'email') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="email" disabled={disabled} value={String(v ?? '')}
        onChange={(e) => set(f.name as keyof AberturaData,
          e.target.value as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );

  if (f.kind === 'tel') return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="tel" disabled={disabled} value={maskTel(String(v ?? ''))}
        placeholder="(00)0 0000-0000"
        maxLength={16}
        onChange={(e) => set(f.name as keyof AberturaData,
          maskTel(e.target.value) as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );

  // text — alphanumeric genérico
  return (
    <label className="text-sm text-muted-foreground-2">{label}
      <input type="text" disabled={disabled} value={String(v ?? '')}
        onChange={(e) => set(f.name as keyof AberturaData,
          e.target.value as AberturaData[keyof AberturaData])}
        className={cls + ' mt-1'} />
    </label>
  );
}
