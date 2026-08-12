'use client';
// Bloco 7, Task 3 — domínio próprio + SLA de atendimento.
//
// A tela funciona por inteiro sem credencial da Vercel (modo manual): mostra
// o CNAME a cadastrar e verifica o apontamento por HTTP. Com credencial, o
// mesmo botão registra o domínio no projeto antes de verificar — nada muda
// aqui.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Loader2, Save, RefreshCw, Trash2, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { salvarDominioAction, verificarDominioAction, removerDominioAction, salvarSlaAction } from '../dominio-actions';

export type DominioSlaInicial = {
  dominio_customizado: string | null;
  dominio_status: 'pendente' | 'ativo' | 'erro';
  dominio_verificado_em: string | null;
  dominio_erro: string | null;
  sla_resposta_horas: number | null;
};

export default function DominioSlaForm({ initial }: { initial: DominioSlaInicial }) {
  const router = useRouter();
  const toast = useToast();
  const [dominio, setDominio] = useState(initial.dominio_customizado ?? '');
  const [sla, setSla] = useState(initial.sla_resposta_horas?.toString() ?? '');
  const [pendente, iniciar] = useTransition();
  const [verificando, setVerificando] = useState(false);

  const status = initial.dominio_status;
  const temDominio = Boolean(initial.dominio_customizado);

  function salvar() {
    iniciar(async () => {
      const r = await salvarDominioAction(dominio);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Domínio salvo. Aponte o DNS e clique em "Verificar agora".');
      router.refresh();
    });
  }

  async function verificar() {
    setVerificando(true);
    try {
      const r = await verificarDominioAction();
      if (!r.ok) { toast('error', r.error); return; }
      if (r.data?.status === 'ativo') toast('success', 'Domínio verificado e ativo.');
      else toast('error', r.data?.motivo ?? 'Não foi possível verificar o domínio.');
      router.refresh();
    } finally {
      setVerificando(false);
    }
  }

  function remover() {
    iniciar(async () => {
      const r = await removerDominioAction();
      if (!r.ok) { toast('error', r.error); return; }
      setDominio('');
      toast('success', 'Domínio removido. Seus clientes seguem atendidos pelo endereço da Balu.');
      router.refresh();
    });
  }

  function salvarSla() {
    const limpo = sla.trim();
    const valor = limpo === '' ? null : Number(limpo);
    iniciar(async () => {
      const r = await salvarSlaAction(valor);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', valor === null ? 'SLA removido.' : `SLA de ${valor}h salvo.`);
      router.refresh();
    });
  }

  return (
    <div className="mt-8 space-y-8">
      {/* ─────────────────────────────── domínio próprio */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <Globe className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Domínio próprio</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Atenda seus clientes em um endereço seu, com a sua marca. O login e os dados continuam
          exatamente os mesmos — muda só o endereço e a identidade visual.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Endereço</span>
            <input
              value={dominio}
              onChange={(e) => setDominio(e.target.value)}
              placeholder="app.seuescritorio.com.br"
              className="rounded-md border border-border bg-background px-3 py-2 text-foreground"
            />
          </label>
          <button
            type="button" onClick={salvar} disabled={pendente || !dominio.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pendente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar
          </button>
        </div>

        {temDominio && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {status === 'ativo' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-primary">
                  <CheckCircle2 className="size-4" /> Ativo
                  {initial.dominio_verificado_em && (
                    <span className="text-muted-foreground">
                      · verificado em {new Date(initial.dominio_verificado_em).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                </span>
              )}
              {status === 'pendente' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-alert/10 px-3 py-1 text-alert">
                  <Clock className="size-4" /> Aguardando verificação
                </span>
              )}
              {status === 'erro' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-destructive">
                  <AlertTriangle className="size-4" /> Não verificado
                </span>
              )}

              <button
                type="button" onClick={verificar} disabled={verificando}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50"
              >
                {verificando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Verificar agora
              </button>
              <button
                type="button" onClick={remover} disabled={pendente}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-4" /> Remover
              </button>
            </div>

            {status === 'erro' && initial.dominio_erro && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
                {initial.dominio_erro}
              </p>
            )}

            {status !== 'ativo' && (
              <div className="rounded-md border border-border bg-background p-3 text-sm">
                <p className="mb-2 font-medium text-foreground">Como apontar o DNS</p>
                <p className="text-muted-foreground">
                  No painel onde seu domínio está registrado, crie um registro <strong>CNAME</strong> para{' '}
                  <code className="rounded bg-surface px-1.5 py-0.5">{initial.dominio_customizado}</code> apontando para{' '}
                  <code className="rounded bg-surface px-1.5 py-0.5">cname.vercel-dns.com</code>. A propagação pode
                  levar algumas horas. Depois, clique em <strong>Verificar agora</strong>.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─────────────────────────────── SLA */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-2">
          <Clock className="size-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Prazo de resposta (SLA)</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Em quantas horas seu escritório se compromete a responder um atendimento. O prazo é
          exibido aos seus clientes e vale em <strong>horas corridas</strong>. Deixe em branco para
          não exibir prazo nenhum.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Horas</span>
            <input
              type="number" min={1} max={720} value={sla}
              onChange={(e) => setSla(e.target.value)}
              placeholder="24"
              className="w-32 rounded-md border border-border bg-background px-3 py-2 text-foreground"
            />
          </label>
          <button
            type="button" onClick={salvarSla} disabled={pendente}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pendente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar prazo
          </button>
        </div>
      </section>
    </div>
  );
}
