'use client';
// 0094/0095/0099 — formulário dos tokens da Focus NFe (AdminBalu).
//
// SÓ IMPORTA DAS ACTIONS. Módulo com `server-only` importado daqui passa no
// `tsc --noEmit` e só quebra no runtime — mordeu o Bloco 4A. `config-focus.ts`
// NÃO entra aqui: ele decifra segredo.
//
// DOIS CAMPOS, DE VOLTA (0099): homologação e produção são tokens DIFERENTES,
// e um não serve no lugar do outro — colar o de homologação para testar
// produção (ou o contrário) dá 401. Ver o cabeçalho da migration 0099 para a
// história de como isto virou um campo só por engano e voltou a ser dois.
//
// OS CAMPOS NASCEM VAZIOS, SEMPRE, mesmo com token gravado: o token guardado
// nunca volta para a tela, nem mascarado, e por isso não há o que preencher.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, PlugZap, Eraser } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import PopupConfirm from '@/components/PopupConfirm';
import { salvarConfigFocusAction, testarConexaoFocusAction, limparConfigFocusAction } from './actions';

// Tipo local, e não importado de `lib/fiscal/config-focus` — mesma regra do
// comentário acima: nada deste componente entra por um módulo `server-only`,
// nem via `import type` (que hoje some no build, mas é uma regra fácil de
// violar por engano depois).
type AmbienteFocus = 'hom' | 'prod';

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

type Props = {
  inicial: {
    /** Booleanos, nunca o token: as colunas cifradas não saem do servidor. */
    temHom: boolean;
    temProd: boolean;
  };
};

export default function ConfigFocusForm({ inicial }: Props) {
  const [tokenHom, setTokenHom] = useState('');
  const [tokenProd, setTokenProd] = useState('');
  const [pendente, iniciar] = useTransition();
  const [testando, setTestando] = useState<AmbienteFocus | null>(null);
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const temAlgumToken = inicial.temHom || inicial.temProd;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await salvarConfigFocusAction({ token_hom: tokenHom, token_prod: tokenProd });
      if (!r.ok) { toast('error', r.error); return; }
      // Somem da tela assim que sai daqui: os campos não guardam segredo entre
      // salvamentos, e o próximo "salvar" não deve regravar o mesmo token.
      setTokenHom('');
      setTokenProd('');
      // CONSERTO 1: a gravação pode ter acontecido sem confirmação da Focus
      // (rede/5xx/timeout na sonda) — o admin precisa saber que "salvo" aqui
      // não é a mesma coisa que "confirmado".
      if (r.aviso) toast('warning', r.aviso);
      else toast('success', 'Token salvo.');
      router.refresh();
    });
  }

  async function handleTestar(ambiente: AmbienteFocus) {
    setTestando(ambiente);
    try {
      const r = await testarConexaoFocusAction(ambiente);
      const nome = ambiente === 'hom' ? 'homologação' : 'produção';
      if (r.ok) toast('success', `A Focus aceitou o token de ${nome}.`);
      else toast('error', r.error);
    } finally {
      setTestando(null);
    }
  }

  async function handleLimpar() {
    setLimpando(true);
    try {
      const r = await limparConfigFocusAction();
      setConfirmandoLimpeza(false);
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Tokens removidos — voltando a usar as variáveis de ambiente.');
      router.refresh();
    } finally {
      setLimpando(false);
    }
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <label className="flex flex-col gap-1">
        <span className={rotuloCampo}>
          <KeyRound className="mr-1 inline size-3.5" />
          Token de homologação
        </span>
        <input
          type="password"
          value={tokenHom}
          onChange={(e) => setTokenHom(e.target.value)}
          placeholder={inicial.temHom ? '•••••••• (guardado — deixe em branco para manter)' : 'cole o token de homologação'}
          autoComplete="off"
          className={campo}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={rotuloCampo}>
          <KeyRound className="mr-1 inline size-3.5" />
          Token de produção
        </span>
        <input
          type="password"
          value={tokenProd}
          onChange={(e) => setTokenProd(e.target.value)}
          placeholder={inicial.temProd ? '•••••••• (guardado — deixe em branco para manter)' : 'cole o token de produção'}
          autoComplete="off"
          className={campo}
        />
      </label>

      <span className="block text-xs text-muted-foreground">
        São dois tokens DIFERENTES da conta da plataforma — um não substitui o outro: o de
        homologação só vale em <code>homologacao.focusnfe.com.br</code>, o de produção só em{' '}
        <code>api.focusnfe.com.br</code>. Preencha só o que estiver trocando; deixar o outro
        campo em branco mantém o que já está gravado. <strong>Nenhum dos dois</strong> é o token
        que emite nota: a emissão usa o token de cada EMPRESA, devolvido pela Focus no cadastro
        dela.
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pendente}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity disabled:opacity-60"
        >
          {pendente && <Loader2 className="size-4 animate-spin" />}
          Salvar
        </button>

        <button
          type="button"
          onClick={() => handleTestar('hom')}
          // DITO NA ENTRADA, NÃO NO ENVIO: sem token guardado o teste não tem o
          // que testar, e descobrir isso depois do clique é a queixa que o
          // Bloco 4A gerou.
          disabled={testando !== null || pendente || !inicial.temHom}
          title={inicial.temHom ? undefined : 'Salve o token de homologação antes de testar.'}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground-2"
        >
          {testando === 'hom' ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Testar homologação
        </button>

        <button
          type="button"
          onClick={() => handleTestar('prod')}
          disabled={testando !== null || pendente || !inicial.temProd}
          title={inicial.temProd ? undefined : 'Salve o token de produção antes de testar.'}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground-2"
        >
          {testando === 'prod' ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Testar produção
        </button>

        {/* CONSERTO 2: sem isto não havia caminho pela interface para desfazer
            uma gravação ruim — campo vazio sempre significou "não trocar",
            nunca "apagar". Só aparece quando HÁ o que limpar. */}
        {temAlgumToken && (
          <button
            type="button"
            onClick={() => setConfirmandoLimpeza(true)}
            disabled={pendente || testando !== null}
            className="inline-flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
          >
            <Eraser className="size-4" />
            Limpar tokens
          </button>
        )}

        {!temAlgumToken && (
          <span className="text-xs text-muted-foreground">
            Enquanto os dois campos estiverem vazios, a plataforma ainda usa as variáveis de
            ambiente — o que já está no ar continua funcionando.
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Cada token é cifrado antes de ir para o banco e nunca aparece em log nem em auditoria —
        o registro guarda apenas quem trocou, quando e qual dos dois. O teste bate no catálogo de
        CNAEs da Focus, na base do próprio ambiente do token — não em <code>/v2/empresas</code>,
        que hoje recusa os dois tokens por um motivo que não é do token (ver a migration 0099).
      </p>
    </form>

      <PopupConfirm
        open={confirmandoLimpeza}
        variant="destructive"
        title="Limpar tokens da Focus"
        description="Os dois tokens gravados (homologação e produção) são apagados, e a plataforma volta a usar as variáveis de ambiente, se houver. Não é possível desfazer — para trocar de novo, será preciso colar os tokens aqui."
        confirmLabel="Limpar tokens"
        onConfirm={handleLimpar}
        onCancel={() => setConfirmandoLimpeza(false)}
        busy={limpando}
      />
    </>
  );
}
