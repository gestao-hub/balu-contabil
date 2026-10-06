'use client';
// "Usar serviço" — o card que emite a cobrança de um serviço do catálogo.
//
// TRÊS DESTINOS: uma empresa da carteira (o cliente vê a cobrança no app), um
// cliente avulso já cadastrado, ou um novo, cadastrado aqui mesmo (0108). Os
// dois últimos não têm app — por isso, depois de emitir, o card oferece mandar
// a fatura por WhatsApp e e-mail.
//
// A CHAVE DE IDEMPOTÊNCIA segue a regra de `clientes/[companyId]/CobrarDialog`:
// nasce uma vez por abertura do card e só é renovada depois de uma emissão
// bem-sucedida — nunca depois de erro. Sem ela, o card não emite.
//
// Só importa módulo puro e a action (módulo `server-only` aqui quebra no runtime).
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Receipt, X } from 'lucide-react';
import { useToast } from '@/components/Toaster';
import CompartilharCobranca from '@/components/CompartilharCobranca';
import { formatBRL, normalizarValorBRL } from '@/lib/format/dinheiro';
import { valorFinalCentavos, type TipoValor } from '@/lib/billing/avulso';
import { documentoValido, emailValido, telefoneValido } from '@/lib/billing/cliente-avulso';
import { novaChaveEmissao } from '@/lib/billing/chave-emissao';
import { ymdBrt } from '@/lib/fiscal/tempo-brt';
import { usarServicoAction } from './usar-actions';

export type EmpresaOpcao = { id: string; nome: string };
export type ClienteAvulsoOpcao = {
  id: string; nome: string; cpfCnpj: string; email: string | null; telefone: string | null;
};
export type ServicoParaUsar = {
  id: string; nome: string; tipoValor: TipoValor; valorCentavos: number | null; percentual: number | null;
};

type Props = {
  servico: ServicoParaUsar;
  empresas: EmpresaOpcao[];
  clientesAvulsos: ClienteAvulsoOpcao[];
  nomeEscritorio: string | null;
  onFechar: () => void;
};

type Modo = 'carteira' | 'avulso';

const rotuloCampo = 'text-xs font-medium text-muted-foreground-2';
const campo = 'rounded-md border border-border bg-surface-2 text-foreground px-3 py-2 text-sm';

function centavosDoTexto(texto: string): number | null {
  const s = normalizarValorBRL(texto);
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return c > 0 ? c : null;
}

/** Valor do <select> de clientes avulsos que abre o cadastro. */
const NOVO = '__novo__';

export default function UsarServicoDialog({
  servico, empresas, clientesAvulsos, nomeEscritorio, onFechar,
}: Props) {
  const toast = useToast();
  const hoje = ymdBrt();
  const [chave, setChave] = useState<string | null>(() => novaChaveEmissao());
  const [modo, setModo] = useState<Modo>(empresas.length > 0 ? 'carteira' : 'avulso');
  const [empresaId, setEmpresaId] = useState('');
  const [avulsoId, setAvulsoId] = useState(clientesAvulsos.length > 0 ? '' : NOVO);
  const [novo, setNovo] = useState({ nome: '', cpfCnpj: '', email: '', telefone: '' });
  const [valorTexto, setValorTexto] = useState('');
  const [descricao, setDescricao] = useState('');
  const [vencimento, setVencimento] = useState(hoje);
  const [erro, setErro] = useState<{ texto: string; linkFatura: string | null } | null>(null);
  const [sucesso, setSucesso] = useState<{
    linkFatura: string | null;
    compartilhar: {
      nome: string; email: string | null; telefone: string | null;
      descricao: string; valorCentavos: number; vencimento: string;
    } | null;
  } | null>(null);
  const [pending, start] = useTransition();

  const percentual = servico.tipoValor === 'percentual';
  const baseCentavos = centavosDoTexto(valorTexto);
  const previsto = valorFinalCentavos(servico, baseCentavos);

  function falhar(texto: string, linkFatura: string | null = null) {
    setErro({ texto, linkFatura });
  }

  function emitir() {
    setErro(null);
    setSucesso(null);
    if (!chave) {
      falhar('Este navegador não conseguiu gerar a chave de segurança da emissão. '
        + 'Atualize a página ou use outro navegador — cobrar sem ela arriscaria emitir duas vezes.');
      return;
    }

    // ─── destino ───
    let destino:
      | { tipo: 'empresa'; companyId: string }
      | { tipo: 'avulso'; clienteAvulsoId: string }
      | { tipo: 'novo'; nome: string; cpfCnpj: string; email: string | null; telefone: string | null };
    if (modo === 'carteira') {
      if (!empresaId) return falhar('Escolha a empresa.');
      destino = { tipo: 'empresa', companyId: empresaId };
    } else if (avulsoId && avulsoId !== NOVO) {
      destino = { tipo: 'avulso', clienteAvulsoId: avulsoId };
    } else {
      if (novo.nome.trim().length < 2) return falhar('Informe o nome do cliente.');
      if (!documentoValido(novo.cpfCnpj)) return falhar('CPF/CNPJ inválido — confira os números.');
      if (novo.email.trim() && !emailValido(novo.email)) return falhar('E-mail inválido.');
      if (novo.telefone.trim() && !telefoneValido(novo.telefone)) {
        return falhar('WhatsApp inválido — informe com DDD.');
      }
      destino = {
        tipo: 'novo', nome: novo.nome.trim(), cpfCnpj: novo.cpfCnpj,
        email: novo.email.trim() || null, telefone: novo.telefone.trim() || null,
      };
    }

    // ─── valor e vencimento: as mesmas regras da action ───
    if (!vencimento) return falhar('Informe o vencimento.');
    if (vencimento < hoje) return falhar('O vencimento não pode ser anterior a hoje.');
    if (percentual && baseCentavos == null) {
      return falhar('Este serviço é percentual — informe o valor-base da cobrança.');
    }
    if (previsto == null) {
      return falhar(percentual
        ? 'Esse valor-base dá uma cobrança de R$ 0,00 — confira o valor antes de emitir.'
        : 'Este serviço está sem valor no catálogo — corrija-o antes de cobrar.');
    }

    start(async () => {
      const r = await usarServicoAction({
        servicoAvulsoId: servico.id,
        destino,
        descricaoLivre: descricao.trim() || null,
        baseCentavos: percentual ? baseCentavos : null,
        vencimento,
        idempotencyKey: chave,
      });
      if (!r.ok) {
        // A chave NÃO é renovada: repetir com a mesma é o que segura o segundo
        // boleto quando a falha foi ambígua.
        falhar(r.error, r.linkFatura ?? null);
        toast('error', r.error);
        return;
      }
      setChave(novaChaveEmissao());
      setSucesso({ linkFatura: r.linkFatura, compartilhar: r.compartilhar });
      toast('success', 'Cobrança emitida.');
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onFechar(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="usar-servico-titulo"
        className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="usar-servico-titulo" className="text-sm font-semibold text-foreground">
              Usar serviço: {servico.nome}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {percentual
                ? `${servico.percentual}% sobre o valor-base`
                : formatBRL(servico.valorCentavos ?? 0)}{' '}
              · a cobrança nasce na conta de recebimento do escritório.
            </p>
          </div>
          <button
            type="button" onClick={onFechar} disabled={pending} title="Fechar"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {sucesso ? (
          <div className="space-y-3">
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                Cobrança emitida.{' '}
                {sucesso.compartilhar
                  ? 'Este cliente não tem o app — mande a fatura para ele:'
                  : 'O cliente já a vê no app dele.'}{' '}
                Ela também está em{' '}
                <Link href="/contador/cobrancas" className="font-medium underline">Cobranças emitidas</Link>.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {sucesso.linkFatura && sucesso.compartilhar && (
                <CompartilharCobranca
                  nomeCliente={sucesso.compartilhar.nome}
                  nomeEscritorio={nomeEscritorio}
                  descricao={sucesso.compartilhar.descricao}
                  valorCentavos={sucesso.compartilhar.valorCentavos}
                  vencimento={sucesso.compartilhar.vencimento}
                  linkFatura={sucesso.linkFatura}
                  telefone={sucesso.compartilhar.telefone}
                  email={sucesso.compartilhar.email}
                />
              )}
              {sucesso.linkFatura && (
                <a
                  href={sucesso.linkFatura} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground-2 hover:border-primary hover:bg-primary/10 hover:text-primary"
                >
                  Abrir a fatura <ExternalLink className="size-3.5" />
                </a>
              )}
              <button
                type="button" onClick={onFechar}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* PARA QUEM */}
            <div className="space-y-2">
              <span className={rotuloCampo}>Para quem<span className="text-destructive"> *</span></span>
              <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1 text-sm" role="tablist">
                {([
                  ['carteira', 'Empresa da carteira'],
                  ['avulso', 'Outro cliente'],
                ] as const).map(([m, rotulo]) => (
                  <button
                    key={m} type="button" role="tab" aria-selected={modo === m}
                    onClick={() => { setModo(m); setErro(null); }}
                    className={`rounded px-2 py-1.5 transition-colors ${
                      modo === m ? 'bg-surface font-semibold text-primary shadow-sm' : 'text-muted-foreground-2 hover:text-foreground'
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              {modo === 'carteira' ? (
                empresas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma empresa na carteira ainda — use &ldquo;Outro cliente&rdquo;.
                  </p>
                ) : (
                  <select
                    value={empresaId}
                    onChange={(e) => { setEmpresaId(e.target.value); setErro(null); }}
                    className={`${campo} w-full`}
                  >
                    <option value="">Escolha a empresa…</option>
                    {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome || 'Empresa sem nome'}</option>)}
                  </select>
                )
              ) : (
                <div className="space-y-2">
                  {clientesAvulsos.length > 0 && (
                    <select
                      value={avulsoId}
                      onChange={(e) => { setAvulsoId(e.target.value); setErro(null); }}
                      className={`${campo} w-full`}
                    >
                      <option value="">Escolha o cliente…</option>
                      {clientesAvulsos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      <option value={NOVO}>+ Cadastrar novo cliente</option>
                    </select>
                  )}
                  {avulsoId === NOVO && (
                    <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Fica só no seu cadastro de cobranças — não entra na carteira nem recebe convite
                        para o app.
                      </p>
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className={rotuloCampo}>Nome / razão social<span className="text-destructive"> *</span></span>
                        <input
                          type="text" value={novo.nome} maxLength={200}
                          onChange={(e) => setNovo((n) => ({ ...n, nome: e.target.value }))}
                          className={campo}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={rotuloCampo}>CPF ou CNPJ<span className="text-destructive"> *</span></span>
                        <input
                          type="text" inputMode="numeric" value={novo.cpfCnpj} maxLength={20}
                          onChange={(e) => setNovo((n) => ({ ...n, cpfCnpj: e.target.value }))}
                          className={campo}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={rotuloCampo}>WhatsApp (com DDD)</span>
                        <input
                          type="tel" value={novo.telefone} maxLength={30} placeholder="(11) 98888-7777"
                          onChange={(e) => setNovo((n) => ({ ...n, telefone: e.target.value }))}
                          className={campo}
                        />
                      </label>
                      <label className="flex flex-col gap-1 sm:col-span-2">
                        <span className={rotuloCampo}>E-mail</span>
                        <input
                          type="email" value={novo.email} maxLength={200}
                          onChange={(e) => setNovo((n) => ({ ...n, email: e.target.value }))}
                          className={campo}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* COBRANÇA */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {percentual && (
                <label className="flex flex-col gap-1">
                  <span className={rotuloCampo}>Valor-base (R$)<span className="text-destructive"> *</span></span>
                  <input
                    type="text" inputMode="decimal" value={valorTexto} placeholder="1.200,00"
                    onChange={(e) => setValorTexto(e.target.value)}
                    className={campo}
                  />
                </label>
              )}
              <label className="flex flex-col gap-1">
                <span className={rotuloCampo}>Vencimento<span className="text-destructive"> *</span></span>
                <input
                  type="date" value={vencimento} min={hoje}
                  onChange={(e) => { setVencimento(e.target.value); setErro(null); }}
                  className={campo}
                />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className={rotuloCampo}>Descrição na fatura</span>
                <input
                  type="text" value={descricao} maxLength={200} placeholder={servico.nome}
                  onChange={(e) => setDescricao(e.target.value)}
                  className={campo}
                />
              </label>
            </div>

            <p className="text-sm text-foreground">
              Valor da cobrança:{' '}
              <strong className="tabular-nums">{previsto == null ? '—' : formatBRL(previsto)}</strong>
            </p>

            {erro && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {erro.texto}
                  {erro.linkFatura && (
                    <>
                      {' '}
                      <a
                        href={erro.linkFatura} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium underline"
                      >
                        Ver a fatura que já existe <ExternalLink className="size-3" />
                      </a>
                    </>
                  )}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button" onClick={emitir} disabled={pending}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}
                {pending ? 'Gerando…' : 'Gerar cobrança'}
              </button>
              <p className="text-xs text-muted-foreground">Emitida de verdade, na hora — não há rascunho.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
