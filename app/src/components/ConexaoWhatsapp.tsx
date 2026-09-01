'use client';
// Conexão de um canal de WhatsApp por QR code — a tela do escritório e a da
// plataforma são a MESMA, e por isso moram aqui.
//
// O que muda entre as duas é texto e quais actions chamar; o que NÃO muda é a
// parte sutil, que é o ciclo de vida do QR:
//
//  1. O QR vem PRONTO como data-URI (`data:image/png;base64,…`) — confirmado
//     ao vivo em 24/08/2026 contra `grupoide.uazapi.com`. Nenhuma biblioteca
//     de QR entra aqui: a string inteira vai no `<img src>`.
//  2. O QR ROTACIONA SOZINHO do lado da uazapi (medido: muda a cada ~20s), e a
//     action de status devolve sempre o corrente. Por isso o polling é UMA
//     chamada que faz as duas coisas: troca a imagem e percebe a conexão.
//  3. O pareamento por CÓDIGO continua existindo onde faz sentido, e não é
//     legado: **não dá para escanear um QR com o mesmo aparelho que se quer
//     conectar**. Quem tem um celular só depende dele.
//
// Duplicar isto em duas telas era garantir que uma das duas ficasse para trás
// no dia em que o contrato da uazapi mudasse.
import { useState, useEffect, useRef, useCallback } from 'react';
import { dataBrt } from '@/lib/format/data-brt';

export type EstadoCanal = { status: string; numero: string | null; qrcode: string | null };
type Resultado<T> = { ok: true; dados: T } | { ok: false; error: string };

export type ConexaoWhatsappProps = {
  status: string;
  numero: string | null;
  conectadoEm: string | null;
  /** Gera (e provisiona, se preciso) o QR. */
  aoConectar: () => Promise<Resultado<{ qrcode: string }>>;
  /** Estado atual + QR corrente. Chamada em polling. */
  aoConsultar: () => Promise<Resultado<EstadoCanal>>;
  aoDesconectar: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Opcional: quando existe, a tela oferece o caminho por código. */
  aoConectarPorCodigo?: (numero: string) => Promise<Resultado<{ paircode: string }>>;
  /** Texto do topo — o que este canal significa para quem está olhando. */
  instrucoes: React.ReactNode;
  /** Frase mostrada quando está conectado, depois do número. */
  textoConectado: string;
};

function formatarNumero(d: string | null): string {
  if (!d) return '—';
  const s = d.replace(/\D+/g, '').replace(/^55/, '');
  return s.length >= 10 ? `(${s.slice(0, 2)}) ${s.slice(2, -4)}-${s.slice(-4)}` : d;
}

export default function ConexaoWhatsapp(props: ConexaoWhatsappProps) {
  const {
    status: inicial, numero: numeroInicial, conectadoEm,
    aoConectar, aoConsultar, aoDesconectar, aoConectarPorCodigo,
    instrucoes, textoConectado,
  } = props;

  const [status, setStatus] = useState(inicial);
  const [numero, setNumero] = useState(numeroInicial);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [paircode, setPaircode] = useState<string | null>(null);
  const [porCodigo, setPorCodigo] = useState(false);
  const [campo, setCampo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const gerarQr = useCallback(async () => {
    setOcupado(true); setErro(null);
    const r = await aoConectar();
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    setQrcode(r.dados.qrcode);
    setStatus('conectando');
  }, [aoConectar]);

  // O QR aparece SOZINHO ao abrir a tela — mas SÓ depois de perguntar ao
  // provedor como está a conexão.
  //
  // ⚠️ POR QUE A CONSULTA VEM ANTES (achado em 24/08/2026, com a instância da
  // plataforma na mão). `POST /instance/connect` numa instância já conectada
  // DERRUBA a sessão viva para parear de novo. O `inicial` aqui é o espelho do
  // BANCO, e ele fica velho fácil: só é atualizado pelo polling de quem está
  // com a tela aberta. Bastava recarregar a página depois de conectar para o
  // efeito pedir QR por cima de um número que estava atendendo — e desconectá-lo.
  //
  // Perguntar primeiro custa uma requisição e usa a FONTE em vez do espelho.
  useEffect(() => {
    if (inicial === 'conectado' || porCodigo) return;
    let vivo = true;
    void (async () => {
      const r = await aoConsultar();
      if (!vivo) return;
      if (r.ok && r.dados.status === 'conectado') {
        // Espelho estava velho: mostra o que é verdade e NÃO pede QR nenhum.
        setStatus('conectado');
        setNumero(r.dados.numero);
        return;
      }
      await gerarQr();
    })();
    return () => { vivo = false; };
  }, [inicial, porCodigo, gerarQr, aoConsultar]);

  // Polling enquanto a conexão está em curso. Sem o `clearInterval` do
  // desmonte, sair da página deixaria a consulta rodando para sempre.
  useEffect(() => {
    if (status === 'conectado') return;
    if (!qrcode && !paircode) return;
    timer.current = setInterval(async () => {
      const r = await aoConsultar();
      if (!r.ok) return;
      if (r.dados.status === 'conectado') {
        setStatus('conectado');
        setNumero(r.dados.numero);
        setQrcode(null);
        setPaircode(null);
        return;
      }
      // Troca a imagem quando o servidor rotacionou o código. Sem isto, a
      // pessoa escaneia um QR que já expirou e nada acontece — sem erro, sem
      // explicação, que é o pior desfecho possível numa tela de conexão.
      if (r.dados.qrcode && !paircode) setQrcode(r.dados.qrcode);
    }, 4000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [status, qrcode, paircode, aoConsultar]);

  async function conectarComCodigo() {
    if (!aoConectarPorCodigo) return;
    setOcupado(true); setErro(null);
    const r = await aoConectarPorCodigo(campo);
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    setPaircode(r.dados.paircode);
    setQrcode(null);
    setStatus('conectando');
  }

  async function desconectar() {
    setOcupado(true); setErro(null);
    const r = await aoDesconectar();
    setOcupado(false);
    if (!r.ok) { setErro(r.error); return; }
    setStatus('desconectado'); setNumero(null); setQrcode(null); setPaircode(null);
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
            {conectadoEm ? ` desde ${dataBrt(conectadoEm)}` : ''}.
            {' '}{textoConectado}
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
        {instrucoes}
      </div>

      {!porCodigo && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Escaneie para conectar</h2>

          {qrcode ? (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- data-URI vinda da
                  uazapi; `next/image` exigiria loader e domínio para um blob que já
                  está em memória e muda a cada 20 segundos. */}
              <img
                src={qrcode}
                alt="QR code para conectar o WhatsApp"
                width={264}
                height={264}
                className="rounded-lg border border-border bg-white p-2"
              />
              <p className="text-center text-xs text-muted-foreground">
                O código se renova sozinho a cada poucos segundos — é normal ele piscar.
                Assim que o WhatsApp confirmar, esta tela muda sozinha.
              </p>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {ocupado ? 'Gerando o código…' : 'Nenhum código no momento.'}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <button
              type="button" onClick={gerarQr} disabled={ocupado}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-surface disabled:opacity-50"
            >
              {ocupado ? 'Gerando…' : 'Gerar novo código'}
            </button>
            {aoConectarPorCodigo && (
              <button
                type="button" onClick={() => { setPorCodigo(true); setQrcode(null); setErro(null); }}
                className="text-sm text-primary underline underline-offset-4"
              >
                Tenho só um celular — conectar por código
              </button>
            )}
          </div>
        </div>
      )}

      {porCodigo && aoConectarPorCodigo && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Conectar por código</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Use isto quando o celular que vai atender é o mesmo que está com esta tela aberta —
            não dá para ele escanear o próprio QR. No WhatsApp, escolha <em>Conectar um
            dispositivo → Conectar com número de telefone</em>. O código expira em poucos
            minutos.
          </p>
          <div className="flex gap-2">
            <input
              id="numero" inputMode="numeric" placeholder="5532999998888"
              value={campo} onChange={(e) => setCampo(e.target.value.replace(/\D/g, ''))}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <button
              type="button" onClick={conectarComCodigo} disabled={ocupado || campo.length < 12}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {ocupado ? 'Gerando…' : paircode ? 'Gerar outro código' : 'Gerar código'}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Formato: 55 + DDD + número.</p>

          {paircode && (
            <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
              <p className="mb-2 text-sm text-muted-foreground">Digite este código no WhatsApp:</p>
              <p className="font-mono text-3xl font-semibold tracking-widest text-foreground">{paircode}</p>
            </div>
          )}

          <button
            type="button" onClick={() => { setPorCodigo(false); setPaircode(null); setErro(null); }}
            className="mt-4 text-sm text-primary underline underline-offset-4"
          >
            Voltar para o QR code
          </button>
        </div>
      )}

      {erro && <p className="text-sm text-danger">{erro}</p>}
    </div>
  );
}
