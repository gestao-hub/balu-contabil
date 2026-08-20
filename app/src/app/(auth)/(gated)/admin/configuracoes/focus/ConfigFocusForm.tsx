'use client';
// 0094/0095 — formulário do token de revenda da Focus NFe (AdminBalu).
//
// SÓ IMPORTA DAS ACTIONS. Módulo com `server-only` importado daqui passa no
// `tsc --noEmit` e só quebra no runtime — mordeu o Bloco 4A. `config-focus.ts`
// NÃO entra aqui: ele decifra segredo.
//
// O CAMPO NASCE VAZIO, SEMPRE, mesmo com token gravado: o token guardado nunca
// volta para a tela, nem mascarado, e por isso não há o que preencher.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, PlugZap } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { salvarConfigFocusAction, testarConexaoFocusAction } from './actions';

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

type Props = {
  inicial: {
    /** Booleano, nunca o token: a coluna cifrada não sai do servidor. */
    temToken: boolean;
  };
};

export default function ConfigFocusForm({ inicial }: Props) {
  const [token, setToken] = useState('');
  const [pendente, iniciar] = useTransition();
  const [testando, setTestando] = useState(false);
  const toast = useToast();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await salvarConfigFocusAction({ token_revenda: token });
      if (!r.ok) { toast('error', r.error); return; }
      // Some da tela assim que sai daqui: o campo não guarda segredo entre
      // salvamentos, e o próximo "salvar" não deve regravar o mesmo token.
      setToken('');
      toast('success', 'Token salvo.');
      router.refresh();
    });
  }

  async function handleTestar() {
    setTestando(true);
    try {
      const r = await testarConexaoFocusAction();
      if (r.ok) toast('success', 'A Focus aceitou o token na API de revenda.');
      else toast('error', r.error);
    } finally {
      setTestando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <label className="flex flex-col gap-1">
        <span className={rotuloCampo}>
          <KeyRound className="mr-1 inline size-3.5" />
          Token de revenda
        </span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={inicial.temToken ? '•••••••• (guardado — deixe em branco para manter)' : 'cole o token de revenda'}
          autoComplete="off"
          className={campo}
        />
        <span className="text-xs text-muted-foreground">
          É o token da conta de revenda, o único aceito para cadastrar empresa, atualizar
          cadastro e enviar certificado. <strong>Não</strong> é o token que emite nota: a
          emissão usa o token de cada empresa, devolvido pela Focus no cadastro dela.
        </span>
      </label>

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
          onClick={handleTestar}
          // DITO NA ENTRADA, NÃO NO ENVIO: sem token guardado o teste não tem o
          // que testar, e descobrir isso depois do clique é a queixa que o
          // Bloco 4A gerou.
          disabled={testando || pendente || !inicial.temToken}
          title={inicial.temToken ? undefined : 'Salve o token antes de testar.'}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground-2"
        >
          {testando ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Testar conexão
        </button>

        {!inicial.temToken && (
          <span className="text-xs text-muted-foreground">
            Enquanto o campo estiver vazio, a plataforma ainda usa o valor da variável de
            ambiente — o que já está no ar continua funcionando.
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        O token é cifrado antes de ir para o banco e nunca aparece em log nem em auditoria —
        o registro guarda apenas quem trocou e quando. O teste bate num endpoint de revenda,
        e não no catálogo público: em 20/08/2026 um token sem acesso à revenda passou no
        catálogo e foi recusado no que interessa.
      </p>
    </form>
  );
}
