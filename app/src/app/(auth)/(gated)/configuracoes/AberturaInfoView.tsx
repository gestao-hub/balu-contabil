// src/app/(auth)/configuracoes/AberturaInfoView.tsx
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AlteracaoDialog from './AlteracaoDialog';
import { createBrowserClient } from '@/lib/supabase/browser';
import { estadoDoc, docsExigidos, type DocRevisao } from '@/lib/abertura/checklist';
import { DOC_KEYS, type DocKey } from '@/types/abertura';

const ETAPAS = ['recebido','em_analise','pendente_documentos','enviado_receita','enviado_junta','enviado_prefeitura','concluido'] as const;
const ETAPA_LABEL: Record<string, string> = {
  recebido: 'Recebido', em_analise: 'Em análise', pendente_documentos: 'Documentos pendentes',
  enviado_receita: 'Enviado à Receita', enviado_junta: 'Na Junta Comercial',
  enviado_prefeitura: 'Na Prefeitura', concluido: 'Concluído', cancelado: 'Cancelado',
};

const DOC_LABEL: Record<DocKey, string> = {
  doc_rg_frente: 'RG (frente)', doc_rg_verso: 'RG (verso)',
  doc_cnh_frente: 'CNH (frente)', doc_cnh_verso: 'CNH (verso)',
  doc_cpf: 'CPF', doc_comprovante_titular: 'Comprovante de residência do titular',
  doc_comprovante_sede: 'Comprovante de endereço da sede', doc_declaracao_uso: 'Declaração de uso do endereço',
};

const ESTADO_BADGE: Record<string, { label: string; cls: string }> = {
  aprovado: { label: 'Aprovado', cls: 'bg-success/10 text-success border-success/40' },
  recusado: { label: 'Recusado', cls: 'bg-destructive/10 text-destructive border-destructive/40' },
  aguardando_analise: { label: 'Aguardando análise', cls: 'bg-alert/10 text-alert border-alert/40' },
  pendente_envio: { label: 'Pendente de envio', cls: 'border-border text-muted-foreground' },
};

export default function AberturaInfoView({ abertura }: { abertura: Record<string, unknown> }) {
  const router = useRouter();
  const [showAlteracao, setShowAlteracao] = useState(false);
  const etapa = String(abertura.processo_etapa ?? 'recebido');
  const idx = ETAPAS.indexOf(etapa as (typeof ETAPAS)[number]);

  const aberturaId = abertura.id as string | undefined;
  useEffect(() => {
    if (!aberturaId) return;
    const supabase = createBrowserClient();
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let ativo = true;
    (async () => {
      // Autentica o socket do Realtime com o JWT do usuário ANTES de assinar; sem
      // isso a conexão é anon e a RLS de abertura_empresas descarta os eventos.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) await supabase.realtime.setAuth(session.access_token);
      if (!ativo) return;
      canal = supabase
        .channel(`abertura-${aberturaId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'abertura_empresas', filter: `id=eq.${aberturaId}` }, () => router.refresh())
        .subscribe();
    })();
    return () => { ativo = false; if (canal) supabase.removeChannel(canal); };
  }, [aberturaId, router]);

  const revisao = (abertura.docs_revisao as Record<string, unknown>) ?? {};
  const tipo = String(abertura.empresa_tipo ?? '');
  const relevantes = new Set<DocKey>([
    ...(tipo ? docsExigidos(tipo) : []),
    ...DOC_KEYS.filter((k) => abertura[k]),
  ]);
  const docsList = DOC_KEYS.filter((k) => relevantes.has(k));

  const row = (label: string, value: unknown) => (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value ? String(value) : '—'}</span>
    </div>
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">Status da abertura</h2>
        {etapa === 'cancelado' ? (
          <p className="text-sm text-destructive">Solicitação cancelada.</p>
        ) : (
          <ol className="flex flex-wrap gap-2">
            {ETAPAS.map((e, i) => (
              <li key={e} className={`text-xs px-2 py-1 rounded-full border ${i <= idx ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                {ETAPA_LABEL[e]}
              </li>
            ))}
          </ol>
        )}
        {!!abertura.processo_protocolo && <p className="text-xs text-muted-foreground mt-2">Protocolo: {abertura.processo_protocolo as string}</p>}
        {!!abertura.processo_observacoes && <p className="text-xs text-muted-foreground mt-1">Obs.: {abertura.processo_observacoes as string}</p>}
        {!!abertura.processo_cnpj_emitido && <p className="text-xs text-foreground mt-1">CNPJ emitido: {abertura.processo_cnpj_emitido as string}</p>}
      </section>

      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">Dados enviados</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {row('Titular', abertura.titular_nome_completo)}
          {row('CPF', abertura.titular_cpf)}
          {row('Telefone', abertura.titular_telefone)}
          {row('E-mail', abertura.titular_email)}
          {row('Razão social (1)', abertura.empresa_razao_social_1)}
          {row('Nome fantasia', abertura.empresa_nome_fantasia)}
          {row('Tipo', abertura.empresa_tipo)}
          {row('Regime', abertura.empresa_regime_tributario)}
          {row('Capital social', abertura.empresa_capital_social)}
          {row('CNAE principal', abertura.empresa_cnae_principal)}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">Documentos</h2>
        {docsList.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum documento a exibir.</p>
        ) : (
          <ul className="space-y-2">
            {docsList.map((k) => {
              const path = (abertura[k] as string | null) ?? null;
              const rev = revisao[k] as DocRevisao | undefined;
              const estado = estadoDoc(path, rev);
              const badge = ESTADO_BADGE[estado];
              return (
                <li key={k} className="space-y-1 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground">{DOC_LABEL[k]}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
                  </div>
                  {estado === 'recusado' && (
                    <>
                      {rev?.observacao && <p className="text-xs text-destructive">Motivo: {rev.observacao}</p>}
                      <button
                        type="button"
                        onClick={() => setShowAlteracao(true)}
                        className="mt-1 text-xs text-primary hover:underline"
                      >
                        Reenviar documentos
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div>
        <button
          type="button"
          onClick={() => setShowAlteracao(true)}
          className="px-4 py-2 text-sm rounded-lg border border-border text-foreground hover:bg-surface-2"
        >
          Solicitar alteração de dados
        </button>
      </div>

      <AlteracaoDialog
        open={showAlteracao}
        onClose={() => setShowAlteracao(false)}
      />
    </div>
  );
}
