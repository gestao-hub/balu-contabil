'use client';
// A Caixa Postal do e-CAC na Balu. Usada pela empresa (/receita/mensagens) e
// pelo escritório (/contador/clientes/[id]/receita) — `companyId` só vem no
// segundo caso.
//
// ⚠️ "Abrir" DÁ CIÊNCIA da intimação: o prazo começa a correr. O botão pede
// confirmação explícita, com o aviso por escrito, antes de chamar a Receita.
// Mensagem já aberta (por aqui) mostra o conteúdo guardado sem nova chamada.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Eye, Inbox, Loader2, Mail, MailOpen, RefreshCw, X } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { dataHoraBrt } from '@/lib/format/data-brt';
import { abrirMensagemReceitaAction, atualizarCaixaPostalAction } from './actions';

export type MensagemReceitaVm = {
  id: string;
  assunto: string;
  origem: string | null;
  relevante: boolean;
  dataEnvio: string | null;
  lidaNaReceita: boolean;
  dataCiencia: string | null;
  conteudo: string | null;
  abertaEm: string | null;
};

const dataBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

function LinhaMensagem({ m }: { m: MensagemReceitaVm }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [conteudo, setConteudo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function abrir(ciente: boolean) {
    setErro(null);
    start(async () => {
      const r = await abrirMensagemReceitaAction(m.id, ciente);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      setConfirmando(false);
      setConteudo(r.data?.conteudo ?? '');
      router.refresh();
    });
  }

  const jaAberta = Boolean(m.conteudo);
  const lida = m.lidaNaReceita || jaAberta;

  return (
    <li className={`rounded-md border bg-surface p-3 ${m.relevante && !lida ? 'border-destructive/50' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            {lida ? <MailOpen className="size-4 text-muted-foreground" /> : <Mail className="size-4 text-primary" />}
            <span className={lida ? '' : 'font-semibold'}>{m.assunto}</span>
            {m.relevante && (
              <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">Importante</span>
            )}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {m.origem ?? 'Receita Federal'} · enviada em {dataBR(m.dataEnvio)}
            {m.dataCiencia ? ` · ciência em ${dataBR(m.dataCiencia)}` : lida ? ' · lida' : ' · não lida'}
          </p>
        </div>

        {!confirmando && !conteudo && (
          <button
            type="button"
            onClick={() => (jaAberta ? setConteudo(m.conteudo) : setConfirmando(true))}
            disabled={pending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
          >
            <Eye className="size-4" /> {jaAberta ? 'Ver mensagem' : 'Abrir'}
          </button>
        )}
      </div>

      {confirmando && (
        <div role="alertdialog" className="mt-3 space-y-2 rounded-md border border-alert/40 bg-alert/10 p-3 text-sm text-foreground">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alert" />
            <span>
              <strong>Abrir esta mensagem conta como ciência da Receita.</strong> Se for uma intimação,
              o prazo para responder começa a contar a partir de agora — igual a abrir no e-CAC.
            </span>
          </p>
          {erro && <p className="text-xs text-destructive">{erro}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button" onClick={() => abrir(true)} disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
              Estou ciente, abrir
            </button>
            <button
              type="button" onClick={() => setConfirmando(false)} disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 disabled:opacity-50"
            >
              Agora não
            </button>
          </div>
        </div>
      )}

      {conteudo !== null && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
          {/* TEXTO puro: o corpo vem de fora e já chega sem HTML (parser). */}
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{conteudo || '(mensagem sem conteúdo)'}</p>
          <button
            type="button" onClick={() => setConteudo(null)}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" /> Fechar
          </button>
        </div>
      )}
    </li>
  );
}

export default function CaixaPostalReceita({
  mensagens, companyId = null, consultadaEm, temCertificado,
}: {
  mensagens: MensagemReceitaVm[];
  companyId?: string | null;
  consultadaEm: string | null;
  temCertificado: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function atualizar() {
    setErro(null);
    start(async () => {
      const r = await atualizarCaixaPostalAction(companyId);
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', r.data?.novas ? `${r.data.novas} mensagem(ns) nova(s).` : 'Caixa Postal atualizada — nada novo.');
      router.refresh();
    });
  }

  const naoLidas = mensagens.filter((m) => !m.lidaNaReceita && !m.conteudo).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {consultadaEm
            ? `Última consulta à Receita: ${dataHoraBrt(consultadaEm)}.`
            : 'Ainda não consultada.'}
          {naoLidas > 0 && <strong className="ml-1 text-foreground">{naoLidas} não lida(s).</strong>}
        </p>
        <button
          type="button" onClick={atualizar} disabled={pending || !temCertificado}
          title={temCertificado ? 'Buscar mensagens na Receita agora' : 'É preciso o certificado digital A1 da empresa'}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} /> {pending ? 'Consultando…' : 'Atualizar'}
        </button>
      </div>

      {!temCertificado && (
        <p className="rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-foreground">
          Para trazer a Caixa Postal do e-CAC, a empresa precisa ter o certificado digital A1 cadastrado
          na Balu.
        </p>
      )}
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}

      {mensagens.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          <Inbox className="mx-auto mb-2 size-6" />
          Nenhuma mensagem da Receita por aqui.
        </div>
      ) : (
        <ul className="space-y-2">{mensagens.map((m) => <LinhaMensagem key={m.id} m={m} />)}</ul>
      )}

      <p className="text-xs text-muted-foreground">
        A Balu consulta a Caixa Postal todos os dias e avisa quando chega mensagem nova. Ela só lê o
        assunto — o conteúdo só é aberto quando você clica, porque abrir conta como ciência.
      </p>
    </section>
  );
}
