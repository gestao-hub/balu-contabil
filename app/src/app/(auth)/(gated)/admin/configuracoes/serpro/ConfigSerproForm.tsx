'use client';
// 0094 — formulário das credenciais do SERPRO (AdminBalu).
//
// SÓ IMPORTA DAS ACTIONS. `config-serpro.ts` e `serpro-contratante.ts` são
// `server-only` e decifram segredo: importados daqui passariam no
// `tsc --noEmit` e só quebrariam no runtime.
//
// OS CAMPOS DE SEGREDO NASCEM VAZIOS, SEMPRE. Vazio quer dizer "não trocar".
import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, PlugZap, FileBadge, Upload } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import {
  salvarConfigSerproAction,
  enviarCertContratanteAction,
  testarConexaoSerproAction,
} from './actions';

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';
const botaoSecundario =
  'inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground-2';

export type CertContratanteVm = {
  cnpj: string;
  subjectCn: string | null;
  /** ISO. A tela formata; o servidor não manda texto já formatado. */
  notAfter: string | null;
} | null;

type Props = {
  inicial: {
    /** Booleanos, nunca as credenciais: as colunas cifradas não saem do servidor. */
    temKey: boolean;
    temSecret: boolean;
    cert: CertContratanteVm;
  };
};

function formatCnpj(v: string): string {
  const d = v.replace(/\D+/g, '');
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export default function ConfigSerproForm({ inicial }: Props) {
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [senhaCert, setSenhaCert] = useState('');
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [pendente, iniciar] = useTransition();
  const [enviandoCert, setEnviandoCert] = useState(false);
  const [testando, setTestando] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const credencialCompleta = inicial.temKey && inicial.temSecret;
  const podeTestar = credencialCompleta && inicial.cert !== null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await salvarConfigSerproAction({
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
      });
      if (!r.ok) { toast('error', r.error); return; }
      setConsumerKey('');
      setConsumerSecret('');
      toast('success', 'Credenciais salvas.');
      router.refresh();
    });
  }

  async function handleEnviarCert(e: React.FormEvent) {
    e.preventDefault();
    const arquivo = arquivoRef.current?.files?.[0];
    if (!arquivo) { toast('error', 'Escolha o arquivo .pfx.'); return; }
    setEnviandoCert(true);
    try {
      const fd = new FormData();
      fd.set('arquivo', arquivo);
      fd.set('senha', senhaCert);
      const r = await enviarCertContratanteAction(fd);
      if (!r.ok) { toast('error', r.error); return; }
      // Some da tela junto com o arquivo: a senha do certificado não fica
      // pendurada num input depois de gravada.
      setSenhaCert('');
      if (arquivoRef.current) arquivoRef.current.value = '';
      toast('success', 'Certificado do contratante atualizado.');
      router.refresh();
    } finally {
      setEnviandoCert(false);
    }
  }

  async function handleTestar() {
    setTestando(true);
    try {
      const r = await testarConexaoSerproAction();
      if (r.ok) toast('success', 'O SERPRO autenticou: credencial e certificado estão válidos.');
      else toast('error', r.error);
    } finally {
      setTestando(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------- consumer key/secret */}
      <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-border bg-surface p-4">
        <h2 className="text-sm font-medium text-foreground">Credenciais do contrato</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>
              <KeyRound className="mr-1 inline size-3.5" />
              Consumer key
            </span>
            <input
              type="password"
              value={consumerKey}
              onChange={(e) => setConsumerKey(e.target.value)}
              placeholder={inicial.temKey ? '•••••••• (guardada — deixe em branco para manter)' : 'cole a consumer key'}
              autoComplete="off"
              className={campo}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>
              <KeyRound className="mr-1 inline size-3.5" />
              Consumer secret
            </span>
            <input
              type="password"
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
              placeholder={inicial.temSecret ? '•••••••• (guardado — deixe em branco para manter)' : 'cole o consumer secret'}
              autoComplete="off"
              className={campo}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pendente}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-opacity disabled:opacity-60"
          >
            {pendente && <Loader2 className="size-4 animate-spin" />}
            Salvar credenciais
          </button>
          {!credencialCompleta && (
            <span className="text-xs text-muted-foreground">
              Os dois campos precisam existir juntos — meia credencial faria a chamada sair
              com a credencial antiga sem avisar.
            </span>
          )}
        </div>
      </form>

      {/* ------------------------------------------ certificado contratante */}
      <form onSubmit={handleEnviarCert} className="space-y-4 rounded-md border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FileBadge className="size-4 shrink-0 text-primary" />
          Certificado A1 do contratante
        </h2>
        <p className="text-sm text-muted-foreground">
          O e-CNPJ que assina o mTLS com a Receita em nome de todos os clientes. Não é o
          certificado de cada empresa — aquele é enviado pelo próprio cliente, na tela de
          configurações dele.
        </p>

        {inicial.cert ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md border border-border bg-surface-2 p-3 text-sm sm:grid-cols-3">
            <div>
              <dt className={rotuloCampo}>CNPJ</dt>
              <dd className="text-foreground">{formatCnpj(inicial.cert.cnpj)}</dd>
            </div>
            <div>
              <dt className={rotuloCampo}>Titular</dt>
              <dd className="truncate text-foreground" title={inicial.cert.subjectCn ?? undefined}>
                {inicial.cert.subjectCn ?? '—'}
              </dd>
            </div>
            <div>
              <dt className={rotuloCampo}>Válido até</dt>
              <dd className="text-foreground">
                {inicial.cert.notAfter
                  ? new Date(inicial.cert.notAfter).toLocaleDateString('pt-BR')
                  : '—'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted-foreground">
            Nenhum certificado de contratante guardado. Sem ele, nenhuma consulta à Receita sai.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>Arquivo .pfx</span>
            <input
              ref={arquivoRef}
              type="file"
              accept=".pfx,.p12"
              className={campo}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>Senha do certificado</span>
            <input
              type="password"
              value={senhaCert}
              onChange={(e) => setSenhaCert(e.target.value)}
              placeholder="senha do arquivo"
              autoComplete="off"
              className={campo}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={enviandoCert} className={botaoSecundario}>
            {enviandoCert ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {inicial.cert ? 'Substituir certificado' : 'Enviar certificado'}
          </button>
          <span className="text-xs text-muted-foreground">
            A senha é conferida na hora: se o arquivo não abrir com ela, nada é gravado.
          </span>
        </div>
      </form>

      {/* ------------------------------------------------------- teste real */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-4">
        <button
          type="button"
          onClick={handleTestar}
          // DITO NA ENTRADA, NÃO NO ENVIO: o /authenticate exige os dois — Basic
          // com a credencial e mTLS com o certificado.
          disabled={testando || !podeTestar}
          title={podeTestar ? undefined : 'Guarde a credencial e o certificado antes de testar.'}
          className={botaoSecundario}
        >
          {testando ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Testar conexão
        </button>
        <span className="text-xs text-muted-foreground">
          Autentica de verdade contra o SERPRO. Como o <code>/authenticate</code> exige a
          credencial e o certificado ao mesmo tempo, o sucesso prova os dois — e nenhum dado
          de contribuinte atravessa.
        </span>
      </div>
    </div>
  );
}
