'use client';
// Pareamento do número do escritório.
//
// O CÓDIGO EXPIRA EM POUCOS MINUTOS — descoberto na prática em 19/08/2026,
// parear na mão. Por isso "Gerar outro código" existe desde a primeira versão,
// e a instrução manda abrir a tela do WhatsApp ANTES de pedir o código.
import { useState, useEffect, useRef } from 'react';
import { conectarWhatsappAction, statusWhatsappAction, desconectarWhatsappAction } from './actions';

type Props = { status: string; numero: string | null; conectadoEm: string | null };

function formatarNumero(d: string | null): string {
  if (!d) return '—';
  const s = d.replace(/\D+/g, '').replace(/^55/, '');
  return s.length >= 10 ? `(${s.slice(0, 2)}) ${s.slice(2, -4)}-${s.slice(-4)}` : d;
}

export default function WhatsappClient({ status: inicial, numero: numeroInicial, conectadoEm }: Props) {
  const [status, setStatus] = useState(inicial);
  const [numero, setNumero] = useState(numeroInicial);
  const [campo, setCampo] = useState('');
  const [paircode, setPaircode] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Polling só enquanto o pareamento está em curso. Sem o `clearInterval` no
  // desmonte, sair da página deixaria a consulta rodando para sempre.
  useEffect(() => {
    if (!paircode || status === 'conectado') return;
    timer.current = setInterval(async () => {
      const r = await statusWhatsappAction();
      if (r.ok && r.dados.status === 'conectado') {
        setStatus('conectado');
        setNumero(r.dados.numero);
        setPaircode(null);
      }
    }, 4000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [paircode, status]);

  async function conectar() {
    setOcupado(true); setErro(null);
    const r = await conectarWhatsappAction(campo);
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    setPaircode(r.dados.paircode);
    setStatus('conectando');
  }

  async function desconectar() {
    setOcupado(true); setErro(null);
    const r = await desconectarWhatsappAction();
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    setStatus('desconectado'); setNumero(null); setPaircode(null);
  }

  if (status === 'conectado') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
            <span className="text-sm font-semibold text-foreground">Conectado</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Número <strong className="text-foreground">{formatarNumero(numero)}</strong>
            {conectadoEm ? ` desde ${new Date(conectadoEm).toLocaleDateString('pt-BR')}` : ''}.
            Seus clientes já podem escrever para ele.
          </p>
        </div>
        {erro && <p className="text-sm text-danger">{erro}</p>}
        <button
          type="button" onClick={desconectar} disabled={ocupado}
          className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-surface disabled:opacity-50"
        >
          {ocupado ? 'Desconectando…' : 'Desconectar número'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Antes de começar</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Use um <strong>número dedicado ao escritório</strong>, não o celular pessoal de
            alguém: toda conversa que chegar nele passa a ser atendida pelo assistente.
          </li>
          <li>
            O código de pareamento <strong>expira em poucos minutos</strong>. Deixe o WhatsApp
            já aberto em <em>Configurações → Dispositivos conectados → Conectar um dispositivo
            → Conectar com número de telefone</em> antes de gerar.
          </li>
        </ul>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <label htmlFor="numero" className="mb-2 block text-sm font-medium text-foreground">
          Número do escritório (com DDD)
        </label>
        <div className="flex gap-2">
          <input
            id="numero" inputMode="numeric" placeholder="5532999998888"
            value={campo} onChange={(e) => setCampo(e.target.value.replace(/\D/g, ''))}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button" onClick={conectar} disabled={ocupado || campo.length < 12}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {ocupado ? 'Gerando…' : paircode ? 'Gerar outro código' : 'Conectar'}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Formato: 55 + DDD + número.</p>
      </div>

      {paircode && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
          <p className="mb-2 text-sm text-muted-foreground">Digite este código no WhatsApp:</p>
          <p className="font-mono text-3xl font-semibold tracking-widest text-foreground">{paircode}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            Assim que o WhatsApp confirmar, esta tela muda sozinha. Se expirar, clique em
            “Gerar outro código”.
          </p>
        </div>
      )}

      {erro && <p className="text-sm text-danger">{erro}</p>}
    </div>
  );
}
