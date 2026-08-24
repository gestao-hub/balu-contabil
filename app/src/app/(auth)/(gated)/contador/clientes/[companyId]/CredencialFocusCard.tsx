'use client';
// Bloco 5 — cadastro da credencial da Focus do CLIENTE, pelo contador (Task 14).
//
// SÓ IMPORTA DAS ACTIONS. `credencial-empresa.ts` é `server-only` e decifra
// segredo — importado daqui passaria no `tsc` e quebraria só no runtime (já
// mordeu o Bloco 4A, e de novo com o token de revenda em `ConfigFocusForm.tsx`).
//
// OS CAMPOS DE TOKEN NASCEM VAZIOS, SEMPRE: o token guardado nunca volta para
// a tela, nem mascarado — o `placeholder` é só aviso de que existe um valor.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, ShieldCheck, ShieldAlert, Building2 } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { salvarCredencialFocusClienteAction, definirModoFiscalAction } from './focus-actions';

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

export type CredencialFocusInfo = {
  companyId: string;
  /** 'propria' = o cliente traz a própria conta Focus; 'balu' = cadastrada
   *  pela plataforma no cadastro. Decide QUEM digita a credencial. */
  origem: 'propria' | 'balu';
  /** Onde esta empresa emite HOJE. 'prod' faz nota fiscal de verdade. */
  ambiente: 'hom' | 'prod';
  temHom: boolean;
  temProd: boolean;
  producaoDeclarada: boolean;
  /** `empresas_fiscais.focus_empresa_id` preenchido: já existe cadastro desta
   *  empresa dentro da conta Focus da Balu. Sair de 'balu' abandona esse
   *  cadastro, e por isso pede confirmação. */
  cadastradaNaContaBalu: boolean;
  /** Por que produção está fora de alcance agora, já em português — o mesmo
   *  motivo que a guarda de emissão daria. `null` quando está liberada.
   *  Calculado no servidor a cada render: a tela nunca oferece um caminho que
   *  a guarda vai recusar depois, na frente do cliente. */
  bloqueioProducao: string | null;
};

export default function CredencialFocusCard(props: CredencialFocusInfo) {
  const {
    companyId, origem, ambiente, temHom, temProd,
    producaoDeclarada, cadastradaNaContaBalu, bloqueioProducao,
  } = props;
  const toast = useToast();
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [tokenHom, setTokenHom] = useState('');
  const [tokenProd, setTokenProd] = useState('');
  const [declaraProducao, setDeclaraProducao] = useState(producaoDeclarada);
  const [autorizado, setAutorizado] = useState(false);

  // Modo de emissão (origem + ambiente) — formulário À PARTE, com estado
  // próprio: trocar o modo não regrava token nenhum, e salvar token não muda o
  // ambiente sem querer. Juntar os dois num submit só faria o clique em
  // "Salvar credencial" ligar produção de raspão.
  const [modoPendente, iniciarModo] = useTransition();
  const [origemEsc, setOrigemEsc] = useState<'propria' | 'balu'>(origem);
  const [ambienteEsc, setAmbienteEsc] = useState<'hom' | 'prod'>(ambiente);
  const [ciente, setCiente] = useState(false);
  const precisaCiencia = origem === 'balu' && origemEsc === 'propria' && cadastradaNaContaBalu;
  const modoMudou = origemEsc !== origem || ambienteEsc !== ambiente;

  function salvarModo(e: React.FormEvent) {
    e.preventDefault();
    if (!modoMudou) return;
    iniciarModo(async () => {
      const r = await definirModoFiscalAction({
        companyId,
        origem: origemEsc,
        ambiente: ambienteEsc,
        ciente_do_cadastro: ciente,
      });
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', ambienteEsc === 'prod'
        ? 'Modo salvo. Esta empresa passa a emitir NOTA FISCAL REAL.'
        : 'Modo de emissão salvo.');
      setCiente(false);
      router.refresh();
    });
  }

  const cardModo = (
    <form onSubmit={salvarModo} className="mb-4 max-w-2xl space-y-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-3 text-sm">
        {ambiente === 'prod'
          ? <ShieldCheck className="size-5 shrink-0 text-success" />
          : <Building2 className="size-5 shrink-0 text-primary" />}
        <div>
          <p className="font-medium text-foreground">Modo de emissão</p>
          <p className="text-muted-foreground-2">
            {ambiente === 'prod'
              ? 'Esta empresa emite em PRODUÇÃO: as notas valem para a prefeitura.'
              : 'Esta empresa emite em homologação — as notas são de teste e não valem para a prefeitura.'}
          </p>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className={rotuloCampo}>Conta na Focus</span>
        <select
          value={origemEsc}
          onChange={(e) => setOrigemEsc(e.target.value as 'propria' | 'balu')}
          className={campo}
        >
          <option value="balu">Conta da Balu — a plataforma cadastra e mantém a empresa na Focus</option>
          <option value="propria">Conta do próprio cliente — a credencial é digitada aqui</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={rotuloCampo}>Ambiente</span>
        <select
          value={ambienteEsc}
          onChange={(e) => setAmbienteEsc(e.target.value as 'hom' | 'prod')}
          className={campo}
        >
          <option value="hom">Homologação (teste)</option>
          <option value="prod">Produção (nota fiscal real)</option>
        </select>
        {bloqueioProducao && ambiente !== 'prod' && (
          <span className="flex items-start gap-1.5 text-[11px] text-alert">
            <ShieldAlert className="mt-px size-3.5 shrink-0" />
            {bloqueioProducao}
          </span>
        )}
      </label>

      {precisaCiencia && (
        <label className="flex items-start gap-2 rounded-lg border border-alert/40 bg-surface-2 p-3 text-sm">
          <input
            type="checkbox"
            checked={ciente}
            onChange={(e) => setCiente(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-muted-foreground-2">
            Esta empresa já está cadastrada na conta Focus da Balu. Ao passar para a conta do
            cliente, o Balu deixa de manter esse cadastro — nada mais é enviado para ele, nem
            certificado nem alteração de dados.
          </span>
        </label>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={modoPendente || !modoMudou}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {modoPendente && <Loader2 className="size-4 animate-spin" />}
          Salvar modo
        </button>
      </div>
    </form>
  );

  if (origem !== 'propria') {
    return (
      <section className="max-w-2xl">
        {cardModo}
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-start gap-3 text-sm">
            <Building2 className="size-5 shrink-0 text-primary" />
            <p className="text-muted-foreground-2">
              Esta empresa emite pela conta Focus da Balu — a credencial foi gerada no cadastro
              dela, não é digitada aqui. O campo de token só aparece para empresas que trazem a
              própria conta Focus.
            </p>
          </div>
        </div>
      </section>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hom = tokenHom.trim();
    const prod = tokenProd.trim();
    if (!hom && !prod) { toast('warning', 'Cole ao menos um dos dois tokens.'); return; }
    if (!autorizado) {
      toast('warning', 'Confirme que o titular autorizou o uso da credencial fiscal dele.');
      return;
    }
    iniciar(async () => {
      const r = await salvarCredencialFocusClienteAction({
        companyId,
        token_hom: hom,
        token_prod: prod,
        autorizacao: autorizado,
        producao_declarada: declaraProducao,
      });
      if (!r.ok) { toast('error', r.error); return; }
      toast('success', 'Credencial da Focus salva.');
      // Some da tela assim que sai daqui: o campo não guarda segredo entre
      // salvamentos, e o próximo "salvar" não deve regravar o mesmo token.
      setTokenHom('');
      setTokenProd('');
      setAutorizado(false);
      router.refresh();
    });
  }

  return (
    <section className="max-w-2xl">
      {cardModo}
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-surface-2 p-4 text-sm">
        {temHom || temProd
          ? <ShieldCheck className="size-5 shrink-0 text-success" />
          : <ShieldAlert className="size-5 shrink-0 text-alert" />}
        <div className="text-muted-foreground-2">
          <p>
            {temHom && temProd
              ? 'Homologação e produção cadastradas.'
              : temHom
                ? 'Só o token de homologação está cadastrado.'
                : temProd
                  ? 'Só o token de produção está cadastrado.'
                  : 'Nenhum token cadastrado ainda — sem ele não sai nota fiscal para esta empresa.'}
          </p>
        </div>
      </div>

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
            placeholder={temHom ? '•••••••• (guardado — deixe em branco para manter)' : 'cole o token de homologação'}
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
            placeholder={temProd ? '•••••••• (guardado — deixe em branco para manter)' : 'cole o token de produção'}
            autoComplete="off"
            className={campo}
          />
          <span className="text-[11px] text-muted-foreground">
            Deixe o campo vazio para não trocar o token já guardado — dá para atualizar só um
            dos dois.
          </span>
        </label>

        <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <input
            type="checkbox"
            checked={declaraProducao}
            onChange={(e) => setDeclaraProducao(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-muted-foreground-2">
            Declaro que a Focus habilitou a emissão de NFS-e em produção para esta empresa. Como
            a conta na Focus é do cliente, a plataforma não tem como conferir isso — a emissão em
            produção depende desta declaração de quem cadastrou.
          </span>
        </label>

        <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <input
            type="checkbox"
            checked={autorizado}
            onChange={(e) => setAutorizado(e.target.checked)}
            className="mt-0.5 size-4 shrink-0"
          />
          <span className="text-muted-foreground-2">
            Declaro que o titular autorizou o uso desta credencial da Focus. Com ela o Balu emite
            nota fiscal em nome do CNPJ desta empresa — o cadastro fica registrado com meu nome e
            a data, e o cliente vê esse registro na conta dele.
          </span>
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pendente}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pendente && <Loader2 className="size-4 animate-spin" />}
            Salvar credencial
          </button>
        </div>
      </form>
    </section>
  );
}
