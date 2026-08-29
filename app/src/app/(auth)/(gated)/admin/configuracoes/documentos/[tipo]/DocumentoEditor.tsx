'use client';
// Editor de um documento legal (AdminBalu).
//
// "Salvar" reescreve a PRÓPRIA versão em exibição (`atual`) — publicada ou
// rascunho, tanto faz; ver o comentário no topo de `../actions.ts` sobre por
// que isso é permitido hoje (pré-lançamento) e deixa de ser depois. Quando
// `aceitesAtual > 0`, a confirmação avisa sem eufemismo antes do clique valer.
//
// "Salvar como nova versão" é o caminho separado que cria um rascunho novo
// (`publicado_em: null`) sem tocar na versão atual — é o único caminho que
// continua correto depois do lançamento.
//
// Não há renderizador de markdown no projeto (nem `react-markdown`, nem
// `marked` — conferido em `package.json`); o mesmo `<pre>` que `/aceite`
// já usa para exibir o texto.
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileDown, Loader2, PenLine, Printer, Save, SendHorizontal, Upload, X } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { salvarDocumentoAction, salvarNovaVersaoDocumentoAction, publicarDocumentoAction } from '../actions';
import { sugerirProximaVersao } from '../versao';
import { htmlParaImpressao, htmlParaWord, nomeArquivo, type MetaExport } from '@/lib/markdown/exportar';

const RÓTULO_TIPO = { termos: 'Termos de Uso', privacidade: 'Política de Privacidade' } as const;

/** Extensões que viram texto direto. `.docx` NÃO está aqui de propósito: é um
 *  ZIP de XML, e “ler” sem biblioteca devolveria lixo binário como se fosse o
 *  documento — o modo mais silencioso de destruir uma peça jurídica. Ver o
 *  aviso em `importarArquivo`. */
const EXTENSOES_TEXTO = ['.md', '.markdown', '.txt', '.html', '.htm'];

/**
 * Teto do arquivo enviado (29/08/2026).
 *
 * ESPELHA `serverActions.bodySizeLimit` do `next.config.ts` — os dois mudam
 * juntos. Ler o arquivo é tudo no navegador e funcionaria com qualquer
 * tamanho; quem recusa é o SALVAMENTO, porque o texto chega ao banco por
 * Server Action. Aceitar aqui mais do que o salvamento aguenta faria a recusa
 * chegar depois da revisão, que é o pior momento.
 *
 * O banco não é o gargalo: `documento_versoes.conteudo_md` é `text` sem
 * limite (~1 GB no Postgres). Ver a nota no `next.config.ts` sobre por que o
 * teto global não foi para lá.
 */
const LIMITE_MB = 100;

/** Acima disto o arquivo é aceito, mas com AVISO. Uma peça jurídica tem alguns
 *  KB; um arquivo de vários MB quase sempre é o `.docx` renomeado, um PDF, ou
 *  o texto colado junto com um anexo. Aceitar calado deixaria a pessoa
 *  esperando um editor que travou. */
const AVISO_MB = 2;


const MB = 1024 * 1024;

/** "1,4 MB" / "820 KB" — na notação que a pessoa lê no explorador de arquivos. */
function tamanhoLegivel(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type LinhaHistorico = {
  id: string;
  versao: string;
  publicadoEm: string | null;
  createdAt: string;
  aceites: number;
};

type DocAtual = {
  id: string;
  versao: string;
  conteudoMd: string;
  publicadoEm: string | null;
};

type Props = {
  tipo: 'termos' | 'privacidade';
  atual: DocAtual | null;
  aceitesAtual: number;
  historico: LinhaHistorico[];
};

function formatarData(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const botaoPrimario = 'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50';
const botaoSecundario = 'inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50';

export default function DocumentoEditor({ tipo, atual, aceitesAtual, historico }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(atual?.conteudoMd ?? '');
  const [pendente, startTransition] = useTransition();

  const [mostrarNovaVersao, setMostrarNovaVersao] = useState(!atual);
  const [versaoNova, setVersaoNova] = useState(atual ? sugerirProximaVersao(atual.versao) : '1.0');

  const [confirmSalvarAberto, setConfirmSalvarAberto] = useState(false);
  const [confirmPublicarAberto, setConfirmPublicarAberto] = useState(false);

  function iniciarEdicao() {
    setTexto(atual?.conteudoMd ?? '');
    setVersaoNova(atual ? sugerirProximaVersao(atual.versao) : '1.0');
    setMostrarNovaVersao(!atual);
    setEditando(true);
  }

  function cancelarEdicao() {
    setTexto(atual?.conteudoMd ?? '');
    setEditando(false);
    setMostrarNovaVersao(!atual);
  }

  function handleSalvarClick() {
    if (!atual) return;
    if (aceitesAtual > 0) {
      setConfirmSalvarAberto(true);
      return;
    }
    executarSalvar();
  }

  function executarSalvar() {
    if (!atual) return;
    startTransition(async () => {
      const r = await salvarDocumentoAction({ tipo, versao: atual.versao, conteudo_md: texto });
      setConfirmSalvarAberto(false);
      if (!r.ok) { toast('error', r.error); return; }
      toast(
        'success',
        r.aceitesNaVersao > 0
          ? `Salvo. ${r.aceitesNaVersao} usuário(s) que já tinham aceitado esta versão agora aceitaram um texto diferente.`
          : 'Salvo.',
      );
      setEditando(false);
      router.refresh();
    });
  }

  function handleSalvarNovaVersao() {
    const versao = versaoNova.trim();
    if (!versao) { toast('error', 'Informe a versão.'); return; }
    startTransition(async () => {
      const r = await salvarNovaVersaoDocumentoAction({ tipo, versao, conteudo_md: texto });
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', `Versão ${versao} criada como rascunho.`);
      setEditando(false);
      router.refresh();
    });
  }

  function executarPublicar() {
    if (!atual) return;
    startTransition(async () => {
      const r = await publicarDocumentoAction({ tipo, versao: atual.versao });
      setConfirmPublicarAberto(false);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', `Versão ${atual.versao} publicada.`);
      router.refresh();
    });
  }

  const ehRascunho = atual ? !atual.publicadoEm : false;

  // ─────────────────────────────────────────────────────────────────────────
  // Exportar e importar (29/08/2026). O documento precisa sair daqui para ser
  // revisado por advogado e voltar depois. Antes, a única saída era selecionar
  // o `<pre>` e copiar — o que entrega markdown cru, com `##` e `**`, a quem
  // não tem por que saber o que isso significa.
  // ─────────────────────────────────────────────────────────────────────────
  const inputArquivo = useRef<HTMLInputElement>(null);

  /** Exporta o texto EM EXIBIÇÃO — inclusive as edições ainda não salvas,
   *  quando o editor está aberto. Mandar ao advogado a versão do banco
   *  enquanto a tela mostra outra coisa seria a pior falha possível aqui. */
  function conteudoParaExportar(): string {
    return editando ? texto : (atual?.conteudoMd ?? '');
  }

  function meta(): MetaExport {
    return {
      titulo: RÓTULO_TIPO[tipo],
      versao: atual?.versao ?? '—',
      publicadoEm: atual?.publicadoEm ?? null,
    };
  }

  function baixar(conteudo: string, nome: string, mime: string) {
    const url = URL.createObjectURL(new Blob(['﻿' + conteudo], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revogar já, e não em timeout: o clique síncrono acima já leu a URL.
    URL.revokeObjectURL(url);
  }

  /** Impressão via iframe oculto, e não `window.open`: janela nova é barrada
   *  por bloqueador de pop-up mesmo vinda de um clique, e imprimir a própria
   *  página levaria junto a sidebar e os botões. */
  function imprimir() {
    const conteudo = conteudoParaExportar();
    if (!conteudo.trim()) { toast('error', 'Não há texto para imprimir.'); return; }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); toast('error', 'Não foi possível abrir a impressão.'); return; }
    doc.open();
    doc.write(htmlParaImpressao(conteudo, meta()));
    doc.close();
    const janela = iframe.contentWindow!;
    // `onafterprint` cobre imprimir e cancelar; o timeout é a rede para os
    // navegadores que não disparam o evento.
    janela.onafterprint = () => iframe.remove();
    setTimeout(() => { if (document.body.contains(iframe)) iframe.remove(); }, 60_000);
    janela.focus();
    janela.print();
  }

  function baixarWord() {
    const conteudo = conteudoParaExportar();
    if (!conteudo.trim()) { toast('error', 'Não há texto para exportar.'); return; }
    baixar(
      htmlParaWord(conteudo, meta()),
      nomeArquivo(RÓTULO_TIPO[tipo], atual?.versao ?? '0', 'doc'),
      'application/msword',
    );
    toast('success', 'Arquivo do Word baixado. Abre no Word e no Google Docs para revisão.');
  }

  async function importarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ''; // permite reescolher o MESMO arquivo depois
    if (!arquivo) return;

    const nome = arquivo.name.toLowerCase();
    if (nome.endsWith('.docx') || nome.endsWith('.doc')) {
      // Recusa explícita, com o caminho. Aceitar e ler como texto devolveria
      // o binário do ZIP dentro do editor.
      toast(
        'error',
        'Arquivo do Word não pode ser lido direto. No Word: Arquivo → Salvar como → '
        + 'Texto sem formatação (.txt), e envie o .txt aqui. Ou cole o texto revisado no editor.',
      );
      return;
    }
    if (!EXTENSOES_TEXTO.some((ext) => nome.endsWith(ext))) {
      toast('error', `Formato não aceito. Use ${EXTENSOES_TEXTO.join(', ')}.`);
      return;
    }

    // Tamanho ANTES de ler: `arquivo.text()` carrega o conteúdo inteiro na
    // memória da aba, então checar depois já seria tarde.
    if (arquivo.size > LIMITE_MB * MB) {
      toast('error', `O arquivo tem ${tamanhoLegivel(arquivo.size)} e o limite é ${LIMITE_MB} MB.`);
      return;
    }
    if (arquivo.size > AVISO_MB * MB) {
      toast(
        'warning',
        `O arquivo tem ${tamanhoLegivel(arquivo.size)} — bem acima do normal para um documento `
        + 'jurídico. Confira se não é um PDF ou um .docx renomeado. O editor pode ficar lento.',
      );
    }

    const bruto = await arquivo.text();
    if (!bruto.trim()) { toast('error', 'O arquivo está vazio.'); return; }

    // O documento volta para o EDITOR, nunca direto para o banco: o admin lê o
    // que chegou e decide entre "salvar" e "salvar como nova versão". Escrever
    // direto pularia o versionamento e a trilha de aceites.
    setTexto(bruto);
    setVersaoNova(atual ? sugerirProximaVersao(atual.versao) : '1.0');
    setMostrarNovaVersao(true);
    setEditando(true);
    toast(
      'success',
      `“${arquivo.name}” carregado no editor. Confira o texto e salve como nova versão.`,
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm">
            {atual ? (
              <span className="text-foreground">
                Versão {atual.versao}
                {' — '}
                {ehRascunho ? (
                  <span className="text-muted-foreground-2">rascunho, não publicada</span>
                ) : (
                  <span className="text-muted-foreground-2">publicada em {formatarData(atual.publicadoEm)}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">Nenhuma versão ainda.</span>
            )}
          </div>

          {!editando && (
            <div className="flex flex-wrap items-center gap-2">
              {ehRascunho && atual && (
                <button
                  type="button"
                  onClick={() => setConfirmPublicarAberto(true)}
                  disabled={pendente}
                  className={botaoPrimario}
                >
                  <SendHorizontal className="size-4" />
                  Publicar
                </button>
              )}
              <button type="button" onClick={iniciarEdicao} disabled={pendente} className={botaoSecundario}>
                <PenLine className="size-4" />
                Editar
              </button>
            </div>
          )}
        </div>

        {/* Levar ao advogado e trazer de volta. Fora do bloco `!editando` de
            propósito: exportar continua valendo com o editor aberto, e é aí
            que se exporta o texto que está sendo escrito. */}
        <div className="mb-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Revisão jurídica
          </span>
          <button
            type="button"
            onClick={imprimir}
            disabled={pendente}
            className={botaoSecundario}
            title="Abre o diálogo de impressão. Escolha “Salvar como PDF” para gerar o arquivo."
          >
            <Printer className="size-4" />
            Imprimir / PDF
          </button>
          <button
            type="button"
            onClick={baixarWord}
            disabled={pendente}
            className={botaoSecundario}
            title="Baixa um arquivo que abre no Word e no Google Docs, editável e com controle de alterações."
          >
            <FileDown className="size-4" />
            Baixar para Word
          </button>
          <button
            type="button"
            onClick={() => inputArquivo.current?.click()}
            disabled={pendente}
            className={botaoSecundario}
            title="Carrega um arquivo revisado no editor. Nada é salvo até você confirmar."
          >
            <Upload className="size-4" />
            Enviar revisado
          </button>
          <input
            ref={inputArquivo}
            type="file"
            accept=".md,.markdown,.txt,.html,.htm,text/plain,text/markdown,text/html"
            onChange={importarArquivo}
            className="hidden"
          />
          <span className="basis-full text-xs text-muted-foreground">
            O arquivo enviado abre no editor para você conferir — nada é gravado sem confirmação.
            Aceita {EXTENSOES_TEXTO.join(', ')} até {LIMITE_MB} MB. Se o advogado devolver{' '}
            <code>.docx</code>, salve antes como <strong>texto sem formatação</strong> no Word.
          </span>
        </div>

        {!editando ? (
          <pre className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-muted-foreground-2 font-sans">
            {atual?.conteudoMd ?? '(vazio)'}
          </pre>
        ) : (
          <div className="space-y-3">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={20}
              className="w-full rounded-md border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-foreground"
            />

            <div className="flex flex-wrap items-center gap-2">
              {atual && (
                <button
                  type="button"
                  onClick={handleSalvarClick}
                  disabled={pendente || !texto.trim()}
                  className={botaoPrimario}
                >
                  {pendente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Salvar
                </button>
              )}
              <button
                type="button"
                onClick={() => setMostrarNovaVersao((v) => !v)}
                disabled={pendente}
                className={botaoSecundario}
              >
                Salvar como nova versão
              </button>
              <button type="button" onClick={cancelarEdicao} disabled={pendente} className={botaoSecundario}>
                <X className="size-4" />
                Cancelar
              </button>
            </div>

            {mostrarNovaVersao && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2 p-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground-2">Número da versão nova</span>
                  <input
                    type="text"
                    value={versaoNova}
                    onChange={(e) => setVersaoNova(e.target.value)}
                    placeholder="ex.: 1.1"
                    className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleSalvarNovaVersao}
                  disabled={pendente || !texto.trim() || !versaoNova.trim()}
                  className={botaoPrimario}
                >
                  {pendente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Criar versão {versaoNova.trim() || '?'} como rascunho
                </button>
                <p className="w-full text-xs text-muted-foreground">
                  Cria uma linha nova, separada da versão {atual?.versao ?? 'atual'}. Fica como rascunho até
                  ser publicada.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">Histórico de versões</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma versão cadastrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground-2">
                  <th className="py-2 pr-4 font-medium">Versão</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Data</th>
                  <th className="py-2 pr-4 font-medium">Aceites</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-4 text-foreground">v{h.versao}</td>
                    <td className="py-2 pr-4">
                      {h.publicadoEm ? (
                        <span className="text-primary">Publicada</span>
                      ) : (
                        <span className="text-muted-foreground-2">Rascunho</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground-2">
                      {formatarData(h.publicadoEm ?? h.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground-2">
                      {h.aceites} usuário{h.aceites === 1 ? '' : 's'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PopupConfirm
        open={confirmSalvarAberto}
        variant="destructive"
        title="Salvar por cima da versão em uso"
        description={
          `Esta versão foi aceita por ${aceitesAtual} usuário(s). Reescrever o texto faz o aceite ` +
          'deles apontar para um texto diferente do que aceitaram.'
        }
        confirmLabel="Salvar mesmo assim"
        onConfirm={executarSalvar}
        onCancel={() => setConfirmSalvarAberto(false)}
        busy={pendente}
      />

      <PopupConfirm
        open={confirmPublicarAberto}
        variant="destructive"
        title="Publicar esta versão"
        description={
          'Publicar troca a versão vigente para todo mundo: TODOS os usuários vão ver a tela de ' +
          'aceite de novo no próximo acesso, mesmo quem já tinha aceitado a versão anterior.'
        }
        confirmLabel="Publicar"
        onConfirm={executarPublicar}
        onCancel={() => setConfirmPublicarAberto(false)}
        busy={pendente}
      />
    </div>
  );
}
