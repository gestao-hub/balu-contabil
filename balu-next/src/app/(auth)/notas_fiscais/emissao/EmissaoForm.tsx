'use client';
// @custom — PR 2.1 — Form de emissão de NFS-e. Client component.
// Não usamos useActionState porque a action redireciona em sucesso (server-side).
// Validação client-side via Zod; submit chama emitirNotaFormAction.
import { useState } from 'react';
import { z } from 'zod';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
import {
  CODIGOS_TRIBUTACAO_FREQUENTES,
  CODIGO_OUTRO_SENTINEL,
  isCodigoTributacaoValido,
} from '@/lib/fiscal/codigos-tributacao';
import { emitirNotaFormAction } from '../actions';

const Schema = z.object({
  clienteId: z.string().uuid({ message: 'Selecione um cliente.' }),
  codigoTributacao: z.string().regex(/^\d{6}$/, 'Código de tributação deve ter 6 dígitos.'),
  descricao: z.string().trim().min(3, 'Descrição muito curta.').max(1000, 'Descrição muito longa.'),
  valorReais: z.number().positive('Valor precisa ser maior que zero.'),
  aliquotaIssPercentual: z.number().min(0, 'Alíquota inválida.').max(100, 'Alíquota inválida.'),
});

export default function EmissaoForm({ clientes }: { clientes: ClienteOption[] }) {
  const [clienteId, setClienteId] = useState<string>('');
  const [codigoBase, setCodigoBase] = useState<string>(CODIGOS_TRIBUTACAO_FREQUENTES[0]!.codigo);
  const [codigoOutro, setCodigoOutro] = useState<string>('');
  const [descricao, setDescricao] = useState<string>('');
  const [valorTexto, setValorTexto] = useState<string>('');
  const [aliquotaTexto, setAliquotaTexto] = useState<string>('5');
  const [clientErr, setClientErr] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const codigoFinal = codigoBase === CODIGO_OUTRO_SENTINEL ? codigoOutro.trim() : codigoBase;
    const valor = parseDecimal(valorTexto);
    const aliquota = parseDecimal(aliquotaTexto);
    const parsed = Schema.safeParse({
      clienteId,
      codigoTributacao: codigoFinal,
      descricao,
      valorReais: valor,
      aliquotaIssPercentual: aliquota,
    });
    if (!parsed.success) {
      e.preventDefault();
      setClientErr(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    if (codigoBase === CODIGO_OUTRO_SENTINEL && !isCodigoTributacaoValido(codigoOutro)) {
      e.preventDefault();
      setClientErr('Código personalizado deve ter 6 dígitos numéricos.');
      return;
    }
    setClientErr(null);
    // Sobrescreve os hidden inputs com os valores normalizados.
    const fd = new FormData(e.currentTarget);
    fd.set('codigoTributacao', codigoFinal);
    fd.set('valorReais', String(valor));
    fd.set('aliquotaIssPercentual', String(aliquota));
    // FormData reusada pela action automaticamente.
  }

  return (
    <form action={emitirNotaFormAction} onSubmit={handleSubmit} className="space-y-5">
      {/* Cliente */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">Cliente (tomador)</label>
        <ClienteCombobox clientes={clientes} value={clienteId} onChange={setClienteId} />
        <input type="hidden" name="clienteId" value={clienteId} />
      </div>

      {/* Código de tributação */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">Código de tributação (Lista Nacional)</label>
        <select
          value={codigoBase}
          onChange={(e) => setCodigoBase(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {CODIGOS_TRIBUTACAO_FREQUENTES.map((c) => (
            <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.label}</option>
          ))}
          <option value={CODIGO_OUTRO_SENTINEL}>Outro (digite o código)</option>
        </select>
        {codigoBase === CODIGO_OUTRO_SENTINEL && (
          <input
            type="text"
            placeholder="6 dígitos (ex: 010701)"
            value={codigoOutro}
            onChange={(e) => setCodigoOutro(e.target.value.replace(/\D+/g, '').slice(0, 6))}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-mono"
          />
        )}
        <input type="hidden" name="codigoTributacao" value={codigoBase === CODIGO_OUTRO_SENTINEL ? codigoOutro : codigoBase} />
      </div>

      {/* Descrição */}
      <div>
        <label htmlFor="descricao" className="block text-sm font-medium text-zinc-700 mb-1">Descrição do serviço</label>
        <textarea
          id="descricao"
          name="descricao"
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          placeholder="Ex: Desenvolvimento de software customizado conforme contrato 2026-001."
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="mt-1 text-xs text-zinc-500">{descricao.length}/1000 caracteres</p>
      </div>

      {/* Valor + Alíquota */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Valor do serviço (R$)</label>
          <input
            type="text"
            inputMode="decimal"
            name="valorReais"
            value={valorTexto}
            onChange={(e) => setValorTexto(maskMoney(e.target.value))}
            placeholder="0,00"
            required
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-1">Alíquota ISS (%)</label>
          <input
            type="text"
            inputMode="decimal"
            name="aliquotaIssPercentual"
            value={aliquotaTexto}
            onChange={(e) => setAliquotaTexto(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="5,00"
            required
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {clientErr && (
        <p className="text-sm text-destructive bg-red-50 border border-red-100 rounded-md px-3 py-2">{clientErr}</p>
      )}

      <SubmitButton disabled={!clienteId} />
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending ? 'Emitindo…' : 'Emitir nota'}
    </button>
  );
}

/** Máscara monetária pt-BR: aceita "1.234,56" ou "1234.56" e normaliza. */
function maskMoney(raw: string): string {
  // Remove tudo exceto dígitos, vírgula, ponto.
  const cleaned = raw.replace(/[^\d.,]/g, '');
  return cleaned;
}

/** Parse pt-BR ("1.234,56") ou en ("1234.56") em number. */
function parseDecimal(s: string): number {
  if (!s) return NaN;
  // Se tem vírgula, é decimal pt-BR; ponto vira separador de milhar.
  if (s.includes(',')) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }
  return Number(s);
}
