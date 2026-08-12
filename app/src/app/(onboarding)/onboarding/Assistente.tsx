'use client';
// Onboarding conversacional. A conversa guia; o cadastro em si continua sendo
// feito pelas telas/actions que já existiam — o assistente identifica o perfil,
// coleta o mínimo e entrega a pessoa no lugar certo.
//
// ⚠️ O histórico guardado aqui é o REDIGIDO (com ⟨CNPJ⟩ no lugar do número).
// Os valores reais vivem no `estado`, que só trafega entre esta tela e a
// action — nunca vai para o provedor de IA.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Loader2, LayoutGrid } from 'lucide-react';
import CreateCompanyDialog from '@/components/CreateCompanyDialog';
import { conversarOnboardingAction } from './assistente-actions';
import type { EstadoOnboarding } from '@/lib/onboarding/maquina';

type Bolha = { de: 'usuario' | 'balu'; texto: string };

const ABERTURA =
  'Oi! Sou o assistente do Balu e vou te ajudar a começar. '
  + 'Você é contador e vai atender clientes por aqui, ou está cadastrando a sua própria empresa? '
  + 'Se ainda não tem CNPJ e quer abrir, pode dizer também.';

export default function Assistente({ onPreferirFormulario }: { onPreferirFormulario: () => void }) {
  const router = useRouter();
  const [bolhas, setBolhas] = useState<Bolha[]>([{ de: 'balu', texto: ABERTURA }]);
  const [entrada, setEntrada] = useState('');
  const [estado, setEstado] = useState<EstadoOnboarding>({ intencao: 'indefinido', campos: {} });
  const [pendente, iniciar] = useTransition();
  const [abrirEmpresa, setAbrirEmpresa] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }); }, [bolhas, pendente]);

  function enviar() {
    const texto = entrada.trim();
    if (!texto || pendente) return;
    setEntrada('');
    setBolhas((b) => [...b, { de: 'usuario', texto }]);

    iniciar(async () => {
      const r = await conversarOnboardingAction({
        mensagem: texto,
        estado,
        // Só o que já está redigido: as bolhas do assistente e as do usuário
        // como ele digitou não — por isso mandamos apenas as do Balu, e a
        // action redige a mensagem nova por conta própria.
        historico: bolhas.filter((b) => b.de === 'balu').map((b) => ({ de: 'balu' as const, texto: b.texto })),
      });

      setEstado(r.estado);

      if (r.concluir === 'abertura') {
        setBolhas((b) => [...b, { de: 'balu', texto: 'Perfeito. Vou te levar para o formulário de abertura, onde a gente coleta os dados e os documentos.' }]);
        setTimeout(() => router.push('/onboarding/abertura'), 900);
        return;
      }
      if (r.concluir === 'escritorio') {
        setBolhas((b) => [...b, { de: 'balu', texto: 'Ótimo. Vou abrir o cadastro do escritório com o que você já me passou.' }]);
        const q = new URLSearchParams();
        if (r.estado.campos.cnpj) q.set('cnpj', r.estado.campos.cnpj);
        if (r.estado.campos.crc) q.set('crc', r.estado.campos.crc);
        if (r.estado.campos.crcUf) q.set('uf', r.estado.campos.crcUf);
        setTimeout(() => router.push(`/contador/cadastro?${q.toString()}`), 900);
        return;
      }
      if (r.concluir === 'empresa') {
        setBolhas((b) => [...b, { de: 'balu', texto: 'Achei o CNPJ. Vou buscar os dados na Receita para você conferir.' }]);
        setAbrirEmpresa(r.estado.campos.cnpj ?? null);
        return;
      }

      setBolhas((b) => [...b, { de: 'balu', texto: r.mensagem }]);
    });
  }

  return (
    <div className="w-full max-w-xl">
      <div className="rounded-2xl border border-border bg-surface">
        <div className="max-h-[52vh] space-y-3 overflow-y-auto p-5">
          {bolhas.map((b, i) => (
            <div key={i} className={b.de === 'usuario' ? 'flex justify-end' : 'flex justify-start'}>
              <p className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                b.de === 'usuario'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface-2 text-foreground'
              }`}>
                {b.texto}
              </p>
            </div>
          ))}
          {pendente && (
            <div className="flex justify-start">
              <p className="rounded-2xl bg-surface-2 px-4 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="inline size-4 animate-spin" /> escrevendo…
              </p>
            </div>
          )}
          <div ref={fim} />
        </div>

        <div className="flex items-center gap-2 border-t border-border p-3">
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }}
            placeholder="Escreva aqui…"
            aria-label="Sua mensagem"
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground"
          />
          <button
            type="button" onClick={enviar} disabled={pendente || !entrada.trim()}
            aria-label="Enviar"
            className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>

      {/* Saída de emergência: quem não quer conversar clica e cai no fluxo de
          sempre. Um cadastro que só existe por chat é um cadastro que trava
          para quem tem pressa — ou para quem o assistente não entendeu. */}
      <div className="mt-5 flex justify-center">
        <button
          type="button" onClick={onPreferirFormulario}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <LayoutGrid className="size-4" />
          Prefiro preencher um formulário
        </button>
      </div>

      {abrirEmpresa !== null && (
        <CreateCompanyDialog
          open
          cnpjInicial={abrirEmpresa}
          onClose={() => setAbrirEmpresa(null)}
          onCreated={() => router.push('/')}
        />
      )}
    </div>
  );
}
