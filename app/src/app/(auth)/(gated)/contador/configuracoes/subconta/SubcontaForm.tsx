'use client';
// src/app/(auth)/(gated)/contador/configuracoes/subconta/SubcontaForm.tsx
// Bloco 4B — criação da subconta do escritório + painel do KYC.
//
// PJ E PF SÃO FORMULÁRIOS DIFERENTES (achado do sandbox, ver
// lib/billing/subconta.ts): `birthDate` só é exigido para CPF; com
// `companyType` de PJ o validador do Asaas para de pedir. Por isso o formulário
// troca os campos conforme o documento digitado, em vez de mostrar os dois e
// recusar depois.
//
// `type="date"` em vez de texto com máscara, de propósito: o input nativo
// entrega YYYY-MM-DD, exatamente o que `normalizarBirthDate` canoniza e o Asaas
// exige — formulário e validação do servidor concordam por construção, sem
// depender da conversão de DD/MM/AAAA no meio de um KYC que não dá para refazer.
//
// SÓ IMPORTA DE MÓDULO PURO (`@/lib/billing/*`, `@/lib/format/*`) e das actions.
// Módulo com `server-only` importado daqui passa no `tsc --noEmit` e só quebra
// no runtime — mordeu o Bloco 4A.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Landmark, Loader2, RefreshCw } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import { formatCep, formatCnpj, formatCpf, formatTel } from '@/lib/format/masks';
import {
  ehPessoaJuridica, soDigitos, validarDadosSubconta,
  type CompanyType, type DadosSubconta,
} from '@/lib/billing/subconta';
import type { StatusSubconta } from '@/lib/billing/status-subconta';
import { criarSubcontaAction, sincronizarStatusSubcontaAction } from './actions';

type Props = {
  nomeSugerido: string;
  /** Só dígitos — o CNPJ do cadastro do escritório, quando houver. */
  documentoSugerido: string;
  status: StatusSubconta;
  walletId: string | null;
  criadaEm: string | null;
};

/** O que cada estado da coluna `asaas_subconta_status` significa PARA O
 *  ESCRITÓRIO. 'recusada' não é um detalhe do painel: é o estado em que a Balu
 *  não tem o que fazer e o escritório precisa agir no Asaas. */
const PAINEL: Record<Exclude<StatusSubconta, 'ausente'>, {
  rotulo: string;
  classe: string;
  titulo: string;
  texto: string;
}> = {
  pendente: {
    rotulo: 'Em análise pelo Asaas',
    classe: 'bg-alert/15 text-alert',
    titulo: 'Conta criada, aguardando a análise',
    texto:
      'O Asaas está conferindo os dados do escritório, os documentos e a conta bancária. '
      + 'Enquanto essa análise não termina, as telas de cobrança ficam indisponíveis — não é '
      + 'escolha da Balu: a conta ainda não pode receber. Quando o Asaas concluir, use '
      + '"Atualizar status" aqui para liberar a emissão.',
  },
  aprovada: {
    rotulo: 'Aprovada — pode cobrar',
    classe: 'bg-success/15 text-success',
    titulo: 'Conta de recebimento ativa',
    texto:
      'As cobranças que você emitir nascem nesta conta: o credor é o escritório e o dinheiro '
      + 'liquida direto na conta dele. A Balu não recebe por você e não retém nada no caminho.',
  },
  recusada: {
    rotulo: 'Recusada pelo Asaas',
    classe: 'bg-destructive/15 text-destructive',
    titulo: 'O Asaas recusou a análise',
    texto:
      'Pelo menos uma etapa foi recusada (dados comerciais, documentos ou conta bancária). '
      + 'A Balu não consegue reverter isso nem criar outra conta para este escritório — quem '
      + 'corrige é você, junto ao Asaas, pelo contato que ele enviou por e-mail. Depois de '
      + 'corrigir, volte aqui e use "Atualizar status". Até lá as telas de cobrança seguem '
      + 'indisponíveis, porque a conta não pode receber. Se não estiver claro o que falta, '
      + 'fale com o suporte da Balu.',
  },
};

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

export default function SubcontaForm({
  nomeSugerido, documentoSugerido, status, walletId, criadaEm,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [dados, setDados] = useState<DadosSubconta>({
    name: nomeSugerido,
    cpfCnpj: documentoSugerido,
    email: '',
    mobilePhone: '',
    incomeValue: 0,
    address: '',
    addressNumber: '',
    province: '',
    postalCode: '',
    birthDate: null,
    companyType: 'LIMITED',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [pending, start] = useTransition();

  const pj = ehPessoaJuridica(dados.cpfCnpj);
  const digitosDoc = soDigitos(dados.cpfCnpj);

  // Mesma faixa que `normalizarBirthDate` aceita no servidor (>= 1900 e no
  // mínimo 18 anos), para o navegador recusar antes da viagem.
  const anoAtual = new Date().getUTCFullYear();

  function set<K extends keyof DadosSubconta>(k: K, v: DadosSubconta[K]) {
    setDados((prev) => ({ ...prev, [k]: v }));
  }

  function handleSincronizar() {
    setErro(null);
    start(async () => {
      const r = await sincronizarStatusSubcontaAction();
      if (!r.ok) { setErro(r.error); toast('error', r.error); return; }
      toast('success', 'Status consultado no Asaas.');
      router.refresh();
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (bloqueado) return;
    setErro(null);
    // As mesmas regras que a action aplica — em português e sem round-trip.
    const v = validarDadosSubconta(dados);
    if (!v.ok) { setErro(v.error); toast('warning', v.error); return; }
    start(async () => {
      const r = await criarSubcontaAction(dados);
      if (!r.ok) {
        setErro(r.error);
        toast('error', r.error);
        // ÚNICO caso em que tentar de novo faz estrago: a subconta já nasceu
        // (ou pode ter nascido) no Asaas e a chave se perdeu, então o banco
        // continua sem `asaas_subconta_id` e nada no servidor impede um segundo
        // clique de criar OUTRA conta. O bloqueio precisa ser aqui — e vem do
        // campo `terminal` da action, não de casamento com o texto da mensagem,
        // que quebrava em silêncio na primeira vez que a frase mudasse.
        if (r.terminal) setBloqueado(true);
        return;
      }
      toast('success', 'Conta de recebimento criada. O Asaas vai analisar os dados.');
      router.refresh();
    });
  }

  const caixaErro = erro && (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{erro}</span>
    </p>
  );

  const botaoSincronizar = (
    <button
      type="button"
      onClick={handleSincronizar}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground-2 hover:bg-surface-2 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      {pending ? 'Consultando…' : 'Atualizar status'}
    </button>
  );

  // ── Já existe subconta: painel do KYC (pendente | aprovada | recusada) ──
  if (status !== 'ausente') {
    const p = PAINEL[status];
    return (
      <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="size-4 shrink-0 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">{p.titulo}</h2>
          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${p.classe}`}>{p.rotulo}</span>
        </div>

        <p className="text-sm text-muted-foreground">{p.texto}</p>

        <dl className="text-xs text-muted-foreground">
          {walletId && (
            <div className="flex gap-1">
              <dt>Carteira:</dt>
              <dd className="font-mono">{walletId}</dd>
            </div>
          )}
          {criadaEm && (
            <div className="flex gap-1">
              <dt>Criada em:</dt>
              <dd>{new Date(criadaEm).toLocaleDateString('pt-BR')}</dd>
            </div>
          )}
        </dl>

        {caixaErro}
        {botaoSincronizar}
        <p className="text-xs text-muted-foreground">
          A consulta é feita no Asaas na hora — nenhum status muda sozinho aqui.
        </p>
      </section>
    );
  }

  // ── Sem subconta: formulário de criação ──
  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Dados da conta de recebimento</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Estes dados vão para o Asaas, que faz a análise cadastral. Os campos mudam conforme o
          documento: CNPJ pede o tipo da empresa, CPF pede a data de nascimento do responsável.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={rotuloCampo}>Nome do escritório<span className="text-destructive"> *</span></span>
          <input
            type="text"
            value={dados.name}
            onChange={(e) => set('name', e.target.value)}
            required
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>CPF ou CNPJ<span className="text-destructive"> *</span></span>
          <input
            type="text"
            inputMode="numeric"
            value={digitosDoc.length > 11 ? formatCnpj(digitosDoc) : formatCpf(digitosDoc)}
            onChange={(e) => set('cpfCnpj', soDigitos(e.target.value).slice(0, 14))}
            placeholder="00.000.000/0000-00"
            required
            className={campo}
          />
        </label>

        {pj ? (
          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>Tipo da empresa<span className="text-destructive"> *</span></span>
            <select
              value={dados.companyType ?? 'LIMITED'}
              onChange={(e) => set('companyType', e.target.value as CompanyType)}
              className={campo}
            >
              <option value="MEI">MEI</option>
              <option value="LIMITED">LTDA</option>
              <option value="INDIVIDUAL">Empresário individual</option>
              <option value="ASSOCIATION">Associação</option>
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className={rotuloCampo}>
              Data de nascimento do responsável<span className="text-destructive"> *</span>
            </span>
            <input
              type="date"
              value={dados.birthDate ?? ''}
              onChange={(e) => set('birthDate', e.target.value || null)}
              min="1900-01-01"
              max={`${anoAtual - 18}-12-31`}
              required
              className={campo}
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>E-mail do responsável<span className="text-destructive"> *</span></span>
          <input
            type="email"
            value={dados.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="responsavel@escritorio.com.br"
            required
            className={campo}
          />
        </label>

        {/* O .slice(0, 11) do celular e irmao dos do documento e do CEP: sem ele
            o 12o digito entra no estado SEM aparecer na tela (o display
            mascarado ja esgotou o maxLength) e segue para um KYC irreversivel,
            voltando como recusa em ingles — o modo de falha que subconta.ts
            existe para evitar. */}
        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Celular com DDD<span className="text-destructive"> *</span></span>
          <input
            type="tel"
            value={formatTel(dados.mobilePhone)}
            onChange={(e) => set('mobilePhone', soDigitos(e.target.value).slice(0, 11))}
            placeholder="(00)0 0000-0000"
            maxLength={16}
            required
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>
            Faturamento mensal estimado (R$)<span className="text-destructive"> *</span>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={dados.incomeValue || ''}
            onChange={(e) => set('incomeValue', Number(e.target.value))}
            required
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>CEP<span className="text-destructive"> *</span></span>
          <input
            type="text"
            inputMode="numeric"
            value={formatCep(dados.postalCode)}
            onChange={(e) => set('postalCode', soDigitos(e.target.value).slice(0, 8))}
            placeholder="00000-000"
            maxLength={9}
            required
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={rotuloCampo}>Endereço<span className="text-destructive"> *</span></span>
          <input
            type="text"
            value={dados.address}
            onChange={(e) => set('address', e.target.value)}
            required
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Número<span className="text-destructive"> *</span></span>
          <input
            type="text"
            value={dados.addressNumber}
            onChange={(e) => set('addressNumber', e.target.value)}
            required
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={rotuloCampo}>Bairro<span className="text-destructive"> *</span></span>
          <input
            type="text"
            value={dados.province}
            onChange={(e) => set('province', e.target.value)}
            required
            className={campo}
          />
        </label>
      </div>

      {/* A caixa de erro fica JUNTO do botão: o formulário é longo e a mensagem
          precisa aparecer onde o olho do escritório já está depois do clique. */}
      {caixaErro}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || bloqueado}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? 'Criando…' : 'Criar conta de recebimento'}
        </button>
        <p className="text-xs text-muted-foreground">
          A conta é criada uma única vez e passa por análise do Asaas.
        </p>
      </div>
    </form>
  );
}
