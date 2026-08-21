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
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PenLine, Save, SendHorizontal, X } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { salvarDocumentoAction, salvarNovaVersaoDocumentoAction, publicarDocumentoAction } from '../actions';
import { sugerirProximaVersao } from '../versao';

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
            <div className="flex items-center gap-2">
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
