'use client';
// @custom — Painel do operador para uma abertura: status + dados coletados +
// download de documentos + avançar processo + concluir (CNPJ) + decidir alterações.
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, CheckCircle2, FileText } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { ETAPAS, ETAPA_LABEL, etapaLabel } from '@/lib/abertura/etapas';
import { estadoDoc, type DocRevisao } from '@/lib/abertura/checklist';
import { avancarProcessoAction, concluirAberturaAction, decidirAlteracaoAction, revisarDocumentoAction, gerarMinutaAction } from '../actions';

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  aprovado: { label: 'Aprovado', cls: 'bg-success/10 text-success border-success/40' },
  recusado: { label: 'Recusado', cls: 'bg-destructive/10 text-destructive border-destructive/40' },
  aguardando_analise: { label: 'Aguardando análise', cls: 'bg-alert/10 text-alert border-alert/40' },
  pendente_envio: { label: 'Pendente de envio', cls: 'border-border text-muted-foreground' },
};

export type DocLink = { key: string; label: string; url: string };
export type AlteracaoItem = {
  id: string; dados: Record<string, unknown>; status: string;
  observacoes: string | null; created_at: string | null;
};
export type AberturaDetalhe = {
  id: string;
  companyStatus: string | null; companyCnpj: string | null;
  processoEtapa: string; processoProtocolo: string | null;
  processoObservacoes: string | null; processoCnpjEmitido: string | null;
  titular_nome_completo: string | null; titular_cpf: string | null;
  titular_telefone: string | null; titular_email: string | null;
  empresa_razao_social_1: string | null; empresa_nome_fantasia: string | null;
  empresa_tipo: string | null; empresa_regime_tributario: string | null;
  empresa_capital_social: string | null; empresa_cnae_principal: string | null;
  empresa_objeto_social: string | null; sede_cidade: string | null; sede_uf: string | null;
};

// Etapas que o operador pode setar (conclusão é ação própria, exige CNPJ).
const ETAPAS_AVANCO = ['recebido', 'em_analise', 'pendente_documentos', 'enviado_receita', 'enviado_junta', 'enviado_prefeitura', 'cancelado'];

function Campo({ label, valor }: { label: string; valor: unknown }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{valor ? String(valor) : '—'}</span>
    </div>
  );
}

export default function DetalheAbertura({ detalhe, docs, alteracoes, revisao }: {
  detalhe: AberturaDetalhe; docs: DocLink[]; alteracoes: AlteracaoItem[]; revisao: Record<string, unknown>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const concluida = detalhe.processoEtapa === 'concluido';
  const idxAtual = ETAPAS.indexOf(detalhe.processoEtapa as (typeof ETAPAS)[number]);

  const [etapa, setEtapa] = useState(detalhe.processoEtapa);
  const [protocolo, setProtocolo] = useState(detalhe.processoProtocolo ?? '');
  const [observacoes, setObservacoes] = useState(detalhe.processoObservacoes ?? '');
  const [cnpj, setCnpj] = useState('');
  const [obs, setObs] = useState<Record<string, string>>({});
  const [gerando, setGerando] = useState(false);

  async function baixarMinuta() {
    setGerando(true);
    try {
      const res = await gerarMinutaAction({ aberturaId: detalhe.id });
      if (!res.ok) { toast('error', res.error); return; }
      if (!res.data) { toast('error', 'Falha ao gerar minuta.'); return; }
      const blob = new Blob([res.data.html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = res.data.filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('success', 'Minuta gerada — abra o arquivo e use "Salvar como PDF".');
    } finally { setGerando(false); }
  }

  const pendentes = alteracoes.filter((a) => a.status === 'pendente');

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { toast('success', okMsg); router.refresh(); }
      else toast('error', res.error);
    });
  }

  return (
    <main className="p-6 max-w-4xl">
      <Link href="/contador/aberturas" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Voltar às aberturas
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">
          {detalhe.empresa_nome_fantasia || detalhe.empresa_razao_social_1 || 'Abertura'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Titular: {detalhe.titular_nome_completo ?? '—'}</p>
      </header>

      {/* Status / timeline */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-foreground">Status</h2>
        <ol className="flex flex-wrap gap-2">
          {ETAPAS.map((e, i) => (
            <li key={e} className={`rounded-full border px-2 py-1 text-xs ${i <= idxAtual ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
              {ETAPA_LABEL[e]}
            </li>
          ))}
        </ol>
        {detalhe.processoCnpjEmitido && (
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-success">
            <CheckCircle2 className="size-4" /> CNPJ emitido: {detalhe.processoCnpjEmitido}
          </p>
        )}
        {detalhe.processoProtocolo && <p className="mt-1 text-xs text-muted-foreground">Protocolo: {detalhe.processoProtocolo}</p>}
      </section>

      {/* Dados coletados */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-foreground">Dados coletados</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo label="Titular" valor={detalhe.titular_nome_completo} />
          <Campo label="CPF" valor={detalhe.titular_cpf} />
          <Campo label="Telefone" valor={detalhe.titular_telefone} />
          <Campo label="E-mail" valor={detalhe.titular_email} />
          <Campo label="Razão social pretendida" valor={detalhe.empresa_razao_social_1} />
          <Campo label="Nome fantasia" valor={detalhe.empresa_nome_fantasia} />
          <Campo label="Tipo" valor={detalhe.empresa_tipo} />
          <Campo label="Regime pretendido" valor={detalhe.empresa_regime_tributario} />
          <Campo label="Capital social" valor={detalhe.empresa_capital_social} />
          <Campo label="CNAE principal" valor={detalhe.empresa_cnae_principal} />
          <Campo label="Sede" valor={detalhe.sede_cidade ? `${detalhe.sede_cidade}${detalhe.sede_uf ? `/${detalhe.sede_uf}` : ''}` : null} />
          <Campo label="Objeto social" valor={detalhe.empresa_objeto_social} />
        </div>
      </section>

      {/* Minuta */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-foreground">Minuta</h2>
        <button type="button" onClick={baixarMinuta} disabled={gerando}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:border-primary disabled:opacity-50">
          <FileText className="size-4 shrink-0 text-primary" /> {gerando ? 'Gerando…' : 'Gerar minuta'}
        </button>
      </section>

      {/* Documentos */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-foreground">Documentos enviados</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum documento enviado.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {docs.map((d) => {
              const rev = revisao[d.key] as DocRevisao | undefined;
              const estado = estadoDoc(d.url, rev);
              const badge = ESTADO_BADGE[estado];
              return (
                <li key={d.key} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <a href={d.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-foreground hover:text-primary">
                      <Download className="size-4 shrink-0 text-primary" /> {d.label}
                    </a>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                  </div>
                  {estado === 'recusado' && rev?.observacao && (
                    <p className="text-xs text-destructive">Motivo: {rev.observacao}</p>
                  )}
                  {!concluida && (
                    <div className="space-y-2">
                      <textarea value={obs[d.key] ?? ''} rows={2}
                        onChange={(ev) => setObs((o) => ({ ...o, [d.key]: ev.target.value }))}
                        placeholder="Observação (obrigatória para recusar)"
                        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs" />
                      <div className="flex gap-2">
                        <button type="button" disabled={pending}
                          onClick={() => run(() => revisarDocumentoAction({ aberturaId: detalhe.id, docKey: d.key, status: 'aprovado' }), 'Documento aprovado')}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                          Aprovar
                        </button>
                        <button type="button" disabled={pending || !obs[d.key]?.trim()}
                          onClick={() => run(() => revisarDocumentoAction({ aberturaId: detalhe.id, docKey: d.key, status: 'recusado', observacao: obs[d.key] }), 'Documento recusado')}
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-2 disabled:opacity-50">
                          Recusar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Alterações pendentes */}
      {pendentes.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-foreground">Alterações solicitadas ({pendentes.length})</h2>
          <div className="space-y-3">
            {pendentes.map((a) => (
              <div key={a.id} className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Solicitada em {a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR') : '—'}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Campo label="Razão social" valor={a.dados.empresa_razao_social_1} />
                  <Campo label="Nome fantasia" valor={a.dados.empresa_nome_fantasia} />
                  <Campo label="Titular" valor={a.dados.titular_nome_completo} />
                  <Campo label="Telefone" valor={a.dados.titular_telefone} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={pending}
                    onClick={() => run(() => decidirAlteracaoAction({ alteracaoId: a.id, aprovar: true }), 'Alteração aprovada')}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    Aprovar
                  </button>
                  <button type="button" disabled={pending}
                    onClick={() => run(() => decidirAlteracaoAction({ alteracaoId: a.id, aprovar: false }), 'Alteração recusada')}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-2 disabled:opacity-50">
                    Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Operar o processo */}
      {!concluida ? (
        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-medium text-foreground">Avançar processo</h2>
            <label className="mb-1 block text-xs text-muted-foreground">Etapa</label>
            <select value={etapa} onChange={(e) => setEtapa(e.target.value)}
              className="mb-3 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
              {ETAPAS_AVANCO.map((e) => <option key={e} value={e}>{etapaLabel(e)}</option>)}
            </select>
            <label className="mb-1 block text-xs text-muted-foreground">Protocolo (opcional)</label>
            <input value={protocolo} onChange={(e) => setProtocolo(e.target.value)}
              className="mb-3 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
            <label className="mb-1 block text-xs text-muted-foreground">Observações (opcional)</label>
            <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2}
              className="mb-3 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
            <button type="button" disabled={pending}
              onClick={() => run(() => avancarProcessoAction({ aberturaId: detalhe.id, etapa, protocolo, observacoes }), 'Status atualizado')}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              Salvar status
            </button>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-medium text-foreground">Concluir abertura</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Informe o CNPJ emitido. A empresa é ativada e o cliente passa a ver a abertura concluída.
            </p>
            <label className="mb-1 block text-xs text-muted-foreground">CNPJ emitido</label>
            <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00"
              className="mb-3 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
            <button type="button" disabled={pending}
              onClick={() => run(() => concluirAberturaAction({ aberturaId: detalhe.id, cnpj }), 'Abertura concluída')}
              className="rounded-md bg-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              Concluir e ativar empresa
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-success/40 bg-success/5 p-4 text-sm text-foreground">
          Abertura concluída. Empresa ativa{detalhe.companyCnpj ? ` — CNPJ ${detalhe.companyCnpj}` : ''}.
        </section>
      )}
    </main>
  );
}
