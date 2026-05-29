// @custom — PR 1.3 + ajustes pós PR 2.1: detalhe da nota fiscal.
// NFSe Nacional emite assíncrono: POST → status='pendente' até webhook chegar
// com autorizado/erro. Em erro, a mensagem da prefeitura vem em
// `payload_focusnfe.callback.erros[].mensagem` (DPS Nacional) ou
// `payload_focusnfe.callback.mensagem` (NFe/NFCe).
import { notFound } from 'next/navigation';
import { AlertTriangle, Clock, Download } from 'lucide-react';
import { createServerClient } from '@/lib/supabase/server';
import { extrairMensagemErro } from '@/lib/fiscal/focus-erro';
import { extrairCamposNota } from '@/lib/fiscal/nfse-callback';
import CancelarButton from './CancelarButton';

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  ativa: { txt: 'Ativa', cls: 'bg-success/10 text-success' },
  pendente: { txt: 'Pendente', cls: 'bg-amber-100 text-amber-700' },
  cancelada: { txt: 'Cancelada', cls: 'bg-zinc-100 text-zinc-600' },
  erro: { txt: 'Erro', cls: 'bg-destructive/10 text-destructive' },
};


function brl(v: number | null) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function NotaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: profile } = await supabase
    .from('profiles').select('current_company').eq('user_id', user.id).single();
  const companyId = (profile?.current_company ?? null) as string | null;
  if (!companyId) notFound();

  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!nota) notFound();

  const payload = (nota.payload_focusnfe ?? {}) as unknown as Record<string, unknown>;
  const dest = (payload.destinatario ?? {}) as Record<string, unknown>;

  // Notas novas (PR 2.1+) têm cliente_id → busca em `clientes`. Notas legadas
  // (Bubble) caem no fallback `payload_focusnfe.destinatario`.
  let clienteNome = (dest.razao_social as string | undefined) ?? '—';
  let clienteDoc = (dest.cnpj as string | undefined) ?? (dest.cpf as string | undefined) ?? '';
  if (nota.cliente_id) {
    const { data: cliente } = await supabase
      .from('clientes').select('razao_social, document')
      .eq('id', nota.cliente_id as string).maybeSingle();
    if (cliente) {
      clienteNome = (cliente.razao_social as string | null) ?? clienteNome;
      clienteDoc = (cliente.document as string | null) ?? clienteDoc;
    }
  }

  // Fallback de leitura: o callback Focus fica em `payload.callback` (estrutura
  // { request, callback }). Notas já autorizadas têm `codigo_verificacao` lá, então
  // a chave aparece mesmo sem reprocessar pelo webhook. NFS-e não tem protocolo —
  // nesse caso exibimos número da nota + link de consulta pública.
  const cb = ((payload.callback ?? payload) as Record<string, unknown>) ?? {};
  const campos = extrairCamposNota(cb);
  const chave = (nota.chave_acesso as string) ?? campos.chaveAcesso ?? '—';
  const protocolo = (nota.protocolo_autorizacao as string) ?? campos.protocolo;
  const numero = (nota.numero_nf as string) ?? campos.numero;
  // urlConsulta vem do callback externo da Focus → valida o scheme antes de virar
  // href (evita XSS via javascript:/data:). Só aceita http(s).
  const urlConsulta =
    campos.urlConsulta && /^https?:\/\//i.test(campos.urlConsulta) ? campos.urlConsulta : null;
  const status = nota.status as string;
  const badge = STATUS_LABEL[status] ?? { txt: status, cls: 'bg-zinc-100 text-zinc-600' };

  return (
    <main className="p-6 max-w-3xl">
      <a href="/notas_fiscais" className="text-sm text-primary hover:underline">← Voltar</a>

      <header className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">
            {nota.tipo_documento} · {nota.referencia}
          </h1>
          <p className="text-sm text-zinc-500">
            Emitida em {nota.data_emissao ? new Date(nota.data_emissao as string).toLocaleString('pt-BR') : '—'}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.cls}`}>{badge.txt}</span>
      </header>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-4 text-sm">
        <div><dt className="text-xs text-zinc-500">Cliente</dt><dd className="text-zinc-800">{clienteNome} {clienteDoc && `(${clienteDoc})`}</dd></div>
        <div><dt className="text-xs text-zinc-500">Valor total</dt><dd className="text-zinc-800">{brl(nota.valor_total as number)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-zinc-500">Chave de acesso</dt><dd className="break-all font-mono text-xs text-zinc-800">{chave}</dd></div>
        {protocolo ? (
          <div className="col-span-2"><dt className="text-xs text-zinc-500">Protocolo de autorização</dt><dd className="text-zinc-800">{protocolo}</dd></div>
        ) : (
          <div className="col-span-2">
            <dt className="text-xs text-zinc-500">Número da NFS-e</dt>
            <dd className="text-zinc-800">
              {numero ?? '—'}
              {urlConsulta && (
                <a href={urlConsulta} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-primary hover:underline">
                  Consultar na prefeitura ↗
                </a>
              )}
            </dd>
          </div>
        )}
      </dl>

      {status === 'cancelada' && (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <p className="font-medium text-zinc-700">Nota cancelada</p>
          {nota.cancelled_at && <p className="text-zinc-600">Em {new Date(nota.cancelled_at as string).toLocaleString('pt-BR')}</p>}
          {nota.cancellation_reason && <p className="mt-1 text-zinc-600">Motivo: {nota.cancellation_reason as string}</p>}
        </div>
      )}

      {status === 'erro' && (() => {
        const err = extrairMensagemErro(payload);
        return (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-medium text-destructive">Não foi possível autorizar a nota</p>
                {err ? (
                  <>
                    <p className="mt-2 text-zinc-700">{err.msg}</p>
                    {err.codigo && (
                      <p className="mt-1 text-xs text-zinc-500 font-mono">Código: {err.codigo}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-zinc-600">
                    A Focus não retornou detalhes do erro. Consulte o painel da Focus pra mais informações.
                  </p>
                )}
                <p className="mt-3 text-xs text-zinc-500">
                  Corrija o dado errado (ex: cliente, valor, código) e emita uma nova nota.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {status === 'pendente' && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <div className="flex items-start gap-3">
            <Clock className="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-700">Processando autorização</p>
              <p className="mt-1 text-zinc-700">
                A Focus enviou pra fila de validação da prefeitura. Volte pra listagem e clique no ícone de atualizar ao lado do status.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a
          href={`/notas_fiscais/${id}/download?formato=xml`}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          <Download className="size-4" /> Baixar XML
        </a>
        <a
          href={`/notas_fiscais/${id}/download?formato=pdf`}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          <Download className="size-4" /> Baixar PDF
        </a>
        <CancelarButton id={id} ativa={status === 'ativa'} />
      </div>
    </main>
  );
}
