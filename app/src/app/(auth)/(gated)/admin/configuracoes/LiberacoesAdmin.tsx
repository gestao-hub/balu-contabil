'use client';
// Bloco 4A — liberação manual de acesso, pelo AdminBalu.
//
// O caso real: o titular paga o boleto, manda o comprovante, e a compensação
// leva de 1 a 3 dias úteis. Sem isto ele fica bloqueado nesse intervalo tendo
// pago — que é o pior momento possível para tirar o acesso de alguém.
import { useState, useTransition } from 'react';
import { KeyRound, ShieldCheck, Search, Paperclip, Download } from 'lucide-react';
import {
  liberarAcessoAction, revogarLiberacaoAction, urlComprovanteLiberacaoAction,
} from './actions';
import {
  validarComprovanteLiberacao, MAX_COMPROVANTE_LIBERACAO_BYTES,
  ACCEPT_COMPROVANTE, FORMATOS_ACEITOS_TEXTO,
} from '@/lib/billing/comprovante-liberacao';
import { DIAS_LIBERACAO_PADRAO, MAX_DIAS_LIBERACAO } from './liberacao';

export type TitularVm = {
  id: string;
  nome: string;
  cnpj: string | null;
  tipo: 'empresa' | 'escritorio';
  status: string;
  /** Já calculado com o MESMO statusEfetivo do gate. */
  bloqueado: boolean;
  contratada: boolean;
  proximaCobrancaEm: string | null;
  liberadoAte: string | null;
  liberacaoMotivo: string | null;
  liberacaoVigente: boolean;
  /** Nome do arquivo anexado, ou null quando a liberação é anterior à 0052. */
  comprovanteNome: string | null;
};

/**
 * Base64 em blocos. `String.fromCharCode(...bytes)` de uma vez estoura a pilha
 * bem antes dos 10 MB que o campo aceita — o spread vira um argumento por byte.
 * Mesma armadilha já resolvida em RegistrarComprovanteDialog.
 */
function paraBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const BLOCO = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += BLOCO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  }
  return btoa(bin);
}

const MB = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;

const dataBr = (d: string) => d.split('-').reverse().join('/');

const ROTULO: Record<string, string> = {
  trial: 'Teste', ativa: 'Ativa', inadimplente: 'Pagamento pendente',
  cancelada: 'Cancelada', cortesia: 'Cortesia',
};

export default function LiberacoesAdmin({ titulares }: { titulares: TitularVm[] }) {
  const [busca, setBusca] = useState('');
  // Mostrar TODOS por padrão seria empurrar o admin a liberar quem está em
  // dia. O filtro começa em quem precisa.
  const [soRelevantes, setSoRelevantes] = useState(true);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [dias, setDias] = useState(String(DIAS_LIBERACAO_PADRAO));
  const [motivo, setMotivo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pending, start] = useTransition();
  const [baixando, setBaixando] = useState<string | null>(null);

  const termo = busca.trim().toLowerCase();
  const lista = titulares.filter((t) => {
    if (soRelevantes && !t.bloqueado && !t.liberacaoVigente) return false;
    if (!termo) return true;
    return t.nome.toLowerCase().includes(termo) || (t.cnpj ?? '').includes(termo);
  });

  function fechar() {
    setAbrindo(null); setMotivo(''); setArquivo(null); setErroArquivo(null);
    setDias(String(DIAS_LIBERACAO_PADRAO));
  }

  /**
   * Valida NA ESCOLHA, não no envio.
   *
   * Antes o arquivo recusado ficava listado como se tivesse sido aceito e só
   * morria no "Confirmar" — a tela dizia uma coisa e o sistema fazia outra.
   * Um arquivo que não serve nunca chega a ser o arquivo selecionado, e o
   * `input` é limpo para o seletor não guardar o que foi recusado.
   */
  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) { setArquivo(null); setErroArquivo(null); return; }

    const v = validarComprovanteLiberacao({ nome: f.name, mime: f.type, tamanho: f.size });
    if (!v.ok) {
      setArquivo(null);
      setErroArquivo(v.error);
      e.target.value = '';
      return;
    }
    setArquivo(f);
    setErroArquivo(null);
  }

  function liberar(id: string) {
    const n = Number(dias);
    setMsg(null);

    // O comprovante é requisito, não enfeite: barra aqui em 0 ms em vez de
    // depois de trafegar megabytes. O servidor revalida de qualquer forma.
    if (!arquivo) {
      setMsg({ tipo: 'erro', texto: 'Anexe o comprovante. Não há liberação sem comprovante.' });
      return;
    }
    const v = validarComprovanteLiberacao({
      nome: arquivo.name, mime: arquivo.type, tamanho: arquivo.size,
    });
    if (!v.ok) { setMsg({ tipo: 'erro', texto: v.error }); return; }

    start(async () => {
      const buf = await arquivo.arrayBuffer();
      const r = await liberarAcessoAction(id, n, motivo, {
        nome: arquivo.name, mime: arquivo.type, base64: paraBase64(buf),
      });
      setMsg(r.ok
        ? { tipo: 'ok', texto: `Acesso liberado por ${n} dia${n > 1 ? 's' : ''}, com comprovante anexado.` }
        : { tipo: 'erro', texto: r.error });
      if (r.ok) fechar();
    });
  }

  /** Pede a URL assinada na hora do clique e abre. Nada de URL de comprovante
   *  no HTML da lista. */
  function verComprovante(id: string) {
    setMsg(null);
    setBaixando(id);
    start(async () => {
      try {
        const r = await urlComprovanteLiberacaoAction(id);
        if (!r.ok) { setMsg({ tipo: 'erro', texto: r.error }); return; }
        window.open(r.url, '_blank', 'noopener,noreferrer');
      } finally {
        setBaixando(null);
      }
    });
  }

  function revogar(id: string) {
    setMsg(null);
    start(async () => {
      const r = await revogarLiberacaoAction(id);
      setMsg(r.ok
        ? { tipo: 'ok', texto: 'Liberação revogada.' }
        : { tipo: 'erro', texto: r.error });
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <KeyRound className="size-4 shrink-0 text-primary" />
          Liberação manual de acesso
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Para quem pagou por boleto e enviou o comprovante antes da compensação. A liberação vale
          até a data escolhida e <strong>expira sozinha</strong>. Quando o pagamento for
          reconhecido, a assinatura vira <em>Ativa</em> normalmente e a liberação deixa de importar.
          <strong className="text-foreground"> Toda liberação exige o comprovante anexado</strong> —
          ele fica guardado junto com quem liberou e por quê.
        </p>
      </div>

      {msg && (
        <p className={`rounded-md border px-3 py-2 text-sm ${
          msg.tipo === 'ok'
            ? 'border-success/40 bg-success/10 text-success'
            : 'border-alert/40 bg-alert/10 text-alert'
        }`}>
          {msg.texto}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou CNPJ"
            className="w-full bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <label className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox" checked={soRelevantes}
            onChange={(e) => setSoRelevantes(e.target.checked)}
          />
          Só bloqueados ou liberados
        </label>
      </div>

      {lista.length === 0 ? (
        <p className="rounded-md border border-border bg-surface px-3 py-4 text-sm text-muted-foreground">
          {soRelevantes
            ? 'Ninguém bloqueado no momento — nada a liberar.'
            : 'Nenhum titular encontrado.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((t) => (
            <li key={t.id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <span className="font-medium">{t.nome}</span>
                    <span className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                      {t.tipo === 'escritorio' ? 'Escritório' : 'Empresa'}
                    </span>
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                      t.bloqueado ? 'bg-alert/15 text-alert' : 'bg-success/15 text-success'
                    }`}>
                      {t.bloqueado ? 'Bloqueado' : 'Liberado'}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ROTULO[t.status] ?? t.status}
                    {t.cnpj ? ` · ${t.cnpj}` : ''}
                    {t.proximaCobrancaEm ? ` · vence ${dataBr(t.proximaCobrancaEm)}` : ''}
                    {!t.contratada && ' · sem contrato no Asaas'}
                  </p>
                  {t.liberacaoVigente && t.liberadoAte && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-success">
                      <ShieldCheck className="mt-0.5 size-3 shrink-0" />
                      <span>
                        Liberado até <strong>{dataBr(t.liberadoAte)}</strong>
                        {t.liberacaoMotivo ? ` — ${t.liberacaoMotivo}` : ''}
                      </span>
                    </p>
                  )}
                  {t.comprovanteNome && (
                    <button
                      type="button" disabled={pending}
                      onClick={() => verComprovante(t.id)}
                      className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground-2 underline-offset-2 hover:text-primary hover:underline disabled:opacity-50"
                    >
                      <Download className="size-3 shrink-0" />
                      {baixando === t.id ? 'Abrindo…' : `Comprovante: ${t.comprovanteNome}`}
                    </button>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button" disabled={pending}
                    onClick={() => (abrindo === t.id ? fechar() : setAbrindo(t.id))}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                  >
                    {t.liberacaoVigente ? 'Renovar' : 'Liberar acesso'}
                  </button>
                  {t.liberacaoVigente && (
                    <button
                      type="button" disabled={pending}
                      onClick={() => revogar(t.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                    >
                      Revogar
                    </button>
                  )}
                </div>
              </div>

              {abrindo === t.id && (
                <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap gap-3">
                    <label className="text-xs text-muted-foreground">
                      Dias
                      <input
                        type="number" min={1} max={MAX_DIAS_LIBERACAO} value={dias}
                        onChange={(e) => setDias(e.target.value)}
                        className="mt-1 block w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                    <label className="min-w-[16rem] flex-1 text-xs text-muted-foreground">
                      Motivo (fica no registro de auditoria)
                      <input
                        value={motivo} onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ex.: comprovante de boleto pago em 27/07"
                        className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
                      />
                    </label>
                  </div>

                  <label className="block text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Paperclip className="size-3 shrink-0" />
                      Comprovante <strong className="text-foreground">obrigatório</strong> —{' '}
                      {FORMATOS_ACEITOS_TEXTO}. Até {MB(MAX_COMPROVANTE_LIBERACAO_BYTES)}
                    </span>
                    <input
                      type="file"
                      // `accept` filtra o seletor do sistema, mas é só sugestão
                      // (dá para trocar para "todos os arquivos"). Quem decide
                      // é o `escolher`, e o servidor revalida depois.
                      accept={ACCEPT_COMPROVANTE}
                      onChange={escolher}
                      className="mt-1 block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-sm file:text-muted-foreground-2 hover:file:border-primary hover:file:text-primary"
                    />
                    {arquivo && (
                      <span className="mt-1 block text-xs text-success">
                        {arquivo.name} · {MB(arquivo.size)}
                      </span>
                    )}
                    {erroArquivo && (
                      <span className="mt-1 block text-xs font-medium text-destructive">
                        {erroArquivo}
                      </span>
                    )}
                  </label>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button" disabled={pending || !arquivo}
                      onClick={() => liberar(t.id)}
                      title={!arquivo ? 'Anexe o comprovante para liberar' : undefined}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {pending ? 'Liberando…' : 'Confirmar liberação'}
                    </button>
                    <button
                      type="button" onClick={fechar}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
