'use client';
// @custom — Form de emissão de NFS-e (dentro do modal). Chama emitirNotaAction direto.
import { useState } from 'react';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import ClienteCombobox, { type ClienteOption } from './ClienteCombobox';
import {
  CODIGOS_TRIBUTACAO_FREQUENTES,
  CODIGO_OUTRO_SENTINEL,
  isCodigoTributacaoValido,
} from '@/lib/fiscal/codigos-tributacao';
import { emitirNotaAction, type CnaeOption } from '../actions';
import type { PreviewImposto } from '@/lib/fiscal/apuracao-types';

const Schema = z.object({
  clienteId: z.string().uuid({ message: 'Selecione um cliente.' }),
  codigoTributacao: z.string().regex(/^\d{6}$/, 'Código de tributação deve ter 6 dígitos.'),
  descricao: z.string().trim().min(3, 'Descrição muito curta.').max(1000, 'Descrição muito longa.'),
  valorReais: z.number().positive('Valor precisa ser maior que zero.'),
  aliquotaIssPercentual: z.number().min(0, 'Alíquota inválida.').max(100, 'Alíquota inválida.'),
});

export default function EmissaoForm({
  clientes,
  previewImposto,
  cnaes,
  onSuccess,
}: {
  clientes: ClienteOption[];
  previewImposto: PreviewImposto;
  cnaes: CnaeOption[];
  onSuccess: () => void;
}) {
  const [clienteId, setClienteId] = useState<string>('');
  const [cnae, setCnae] = useState<string>(cnaes.length === 1 ? cnaes[0]!.codigo : '');
  const [codigoBase, setCodigoBase] = useState<string>(CODIGOS_TRIBUTACAO_FREQUENTES[0]!.codigo);
  const [codigoOutro, setCodigoOutro] = useState<string>('');
  const [descricao, setDescricao] = useState<string>('');
  const [valorTexto, setValorTexto] = useState<string>('');
  const [aliquotaTexto, setAliquotaTexto] = useState<string>('5');
  const [clientErr, setClientErr] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (cnaes.length > 1 && !cnae) {
      setClientErr('Selecione a atividade (CNAE) da nota.');
      return;
    }
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
      setClientErr(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return;
    }
    if (codigoBase === CODIGO_OUTRO_SENTINEL && !isCodigoTributacaoValido(codigoOutro)) {
      setClientErr('Código personalizado deve ter 6 dígitos numéricos.');
      return;
    }
    setClientErr(null);
    setEnviando(true);
    try {
      const r = await emitirNotaAction({
        clienteId,
        codigoTributacao: codigoFinal,
        descricao,
        valorReais: valor,
        aliquotaIssPercentual: aliquota,
        cnae: cnae || null,
      });
      if (!r.ok) {
        setClientErr(r.error);
        return;
      }
      onSuccess();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Cliente */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Cliente (tomador)</label>
        <ClienteCombobox clientes={clientes} value={clienteId} onChange={setClienteId} />
        <input type="hidden" name="clienteId" value={clienteId} />
      </div>

      {/* Código de tributação */}
      <div>
        <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Código de tributação (Lista Nacional)</label>
        <select
          value={codigoBase}
          onChange={(e) => setCodigoBase(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
            className="mt-2 w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm font-mono"
          />
        )}
        <input type="hidden" name="codigoTributacao" value={codigoBase === CODIGO_OUTRO_SENTINEL ? codigoOutro : codigoBase} />
      </div>

      {cnaes.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Atividade (CNAE)</label>
          {cnaes.length === 1 ? (
            <div className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm">
              {cnaes[0]!.codigo}{cnaes[0]!.descricao ? ` · ${cnaes[0]!.descricao}` : ''}
              {cnaes[0]!.anexoLabel ? ` (${cnaes[0]!.anexoLabel})` : ''}
            </div>
          ) : (
            <select
              value={cnae}
              onChange={(e) => setCnae(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Selecione…</option>
              {cnaes.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo}{c.descricao ? ` · ${c.descricao}` : ''}{c.anexoLabel ? ` (${c.anexoLabel})` : ''}
                </option>
              ))}
            </select>
          )}
          <input type="hidden" name="cnae" value={cnae} />
        </div>
      )}

      {/* Descrição */}
      <div>
        <label htmlFor="descricao" className="block text-sm font-medium text-muted-foreground-2 mb-1">Descrição do serviço</label>
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
          className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">{descricao.length}/1000 caracteres</p>
      </div>

      {/* Valor + Alíquota */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Valor do serviço (R$)</label>
          <input
            type="text"
            inputMode="decimal"
            name="valorReais"
            value={valorTexto}
            onChange={(e) => setValorTexto(maskMoney(e.target.value))}
            placeholder="0,00"
            required
            className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground-2 mb-1">Alíquota ISS (%)</label>
          <input
            type="text"
            inputMode="decimal"
            name="aliquotaIssPercentual"
            value={aliquotaTexto}
            onChange={(e) => setAliquotaTexto(e.target.value.replace(/[^\d.,]/g, ''))}
            placeholder="5,00"
            required
            className="w-full rounded-lg border border-border bg-surface-2 text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {previewImposto.tipo === 'simples' && (() => {
        const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
        const valor = parseDecimal(valorTexto) || 0;
        const imposto = valor * previewImposto.aliquota;
        return (
          <p className="text-sm text-muted-foreground bg-surface-2 border border-border rounded-md px-3 py-2">
            Imposto estimado (DAS): <span className="font-medium text-foreground">{brl.format(imposto)}</span>
            {' '}— ≈{(previewImposto.aliquota * 100).toFixed(2)}% · estimativa
          </p>
        );
      })()}
      {previewImposto.tipo === 'mei' && (() => {
        const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
        return (
          <p className="text-sm text-muted-foreground bg-surface-2 border border-border rounded-md px-3 py-2">
            MEI: DAS fixo de <span className="font-medium text-foreground">{brl.format(previewImposto.valorFixo)}</span>/mês — não varia por nota.
          </p>
        );
      })()}

      {clientErr && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{clientErr}</p>
      )}

      <SubmitButton disabled={!clienteId} enviando={enviando} />
    </form>
  );
}

function SubmitButton({ disabled, enviando }: { disabled: boolean; enviando: boolean }) {
  return (
    <button
      type="submit"
      disabled={enviando || disabled}
      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
    >
      {enviando && <Loader2 className="size-4 animate-spin" />}
      {enviando ? 'Emitindo…' : 'Emitir nota'}
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
