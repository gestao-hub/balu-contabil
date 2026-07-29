'use client';
// Bloco 6A — formulário do provedor de IA (AdminBalu).
//
// SÓ IMPORTA DE MÓDULO PURO (`@/lib/ai/provedores`) e das actions. Módulo com
// `server-only` importado daqui passa no `tsc --noEmit` e só quebra no runtime —
// mordeu o Bloco 4A. `cliente.ts` e `config-ia.ts` NÃO entram aqui: o primeiro é
// server-only, o segundo decifra segredo.
//
// O CAMPO DA CHAVE NASCE VAZIO, SEMPRE, mesmo com chave gravada. Vazio quer
// dizer "não trocar" — a chave gravada nunca volta para a tela, nem mascarada,
// e por isso não há o que preencher.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, PlugZap } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { PROVEDORES, PROVEDOR_LABEL, type Provedor } from '@/lib/ai/provedores';
import { salvarConfigIaAction, testarConexaoIaAction } from './actions';

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

type Props = {
  inicial: {
    provedor: Provedor | null;
    modelo: string;
    baseUrl: string;
    /** Booleano, nunca a chave: a coluna cifrada não sai do servidor. */
    temChave: boolean;
  };
};

export default function ConfigIaForm({ inicial }: Props) {
  const [provedor, setProvedor] = useState<Provedor>(inicial.provedor ?? 'anthropic');
  const [modelo, setModelo] = useState(inicial.modelo);
  const [baseUrl, setBaseUrl] = useState(inicial.baseUrl);
  const [chave, setChave] = useState('');
  const [pendente, iniciar] = useTransition();
  const [testando, setTestando] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const personalizado = provedor === 'personalizado';
  // A chave gravada continua valendo enquanto o admin não digitar outra.
  const teraChave = inicial.temChave || chave.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await salvarConfigIaAction({
        provedor, modelo, base_url: personalizado ? baseUrl : null, chave,
      });
      if (!r.ok) { toast('error', r.error); return; }
      // Some da tela assim que sai daqui: o campo não guarda segredo entre
      // salvamentos, e o próximo "salvar" não deve regravar a mesma chave.
      setChave('');
      toast('success', 'Configuração salva.');
      router.refresh();
    });
  }

  async function handleTestar() {
    setTestando(true);
    try {
      const r = await testarConexaoIaAction();
      if (r.ok) toast('success', 'O provedor respondeu. Credencial e modelo estão válidos.');
      else toast('error', r.error);
    } finally {
      setTestando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Provedor<span className="text-destructive"> *</span></span>
          <select
            value={provedor}
            onChange={(e) => setProvedor(e.target.value as Provedor)}
            className={campo}
          >
            {PROVEDORES.map((p) => (
              <option key={p} value={p}>{PROVEDOR_LABEL[p]}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Modelo<span className="text-destructive"> *</span></span>
          <input
            type="text"
            value={modelo}
            onChange={(e) => setModelo(e.target.value)}
            placeholder="ex.: claude-sonnet-4-6"
            required
            className={campo}
          />
        </label>

        {personalizado && (
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={rotuloCampo}>URL base<span className="text-destructive"> *</span></span>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://meu-provedor.exemplo/v1"
              required
              className={campo}
            />
            <span className="text-xs text-muted-foreground">
              Precisa ser https — a chave viaja no cabeçalho da requisição.
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={rotuloCampo}>
            <KeyRound className="mr-1 inline size-3.5" />
            Chave da API
          </span>
          <input
            type="password"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            placeholder={inicial.temChave ? '•••••••• (guardada — deixe em branco para manter)' : 'cole a chave aqui'}
            autoComplete="off"
            className={campo}
          />
          <span className="text-xs text-muted-foreground">
            {inicial.temChave
              ? 'Já há uma chave guardada, cifrada. Ela nunca volta para esta tela; preencha só para trocar.'
              : 'A chave é cifrada antes de ir para o banco e nunca aparece em log nem em auditoria.'}
          </span>
        </label>
      </div>

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
          // DITO NA ENTRADA, NÃO NO ENVIO: sem chave gravada o teste não tem o
          // que testar, e descobrir isso depois do clique é a queixa que o
          // Bloco 4A gerou.
          disabled={testando || pendente || !inicial.temChave}
          title={inicial.temChave ? undefined : 'Salve a chave antes de testar.'}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground-2"
        >
          {testando ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Testar conexão
        </button>

        {!inicial.temChave && (
          <span className="text-xs text-muted-foreground">
            {teraChave
              ? 'Salve para guardar a chave e liberar o teste.'
              : 'Sem chave guardada não há como testar — nem como gerar rascunho.'}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Este provedor só redige <strong>rascunhos</strong> do catálogo de explicações. Nenhum
        cliente vê texto que um humano não tenha aprovado, e nenhum dado de contribuinte sai
        da Balu — a IA recebe apenas a forma da situação fiscal.
      </p>
    </form>
  );
}
