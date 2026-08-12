// Bloco 7, Task 4 — sob o dominio proprio do escritorio, a area publica
// (login, cadastro, convite, reset de senha) ganha a marca dele no topo.
//
// CO-BRANDING, nao substituicao: o logo da Balu segue dentro do card de
// login. E a decisao do Bloco A, e nao ha motivo pra reabrir aqui — o
// cliente precisa saber em que produto esta entrando, e o escritorio,
// aparecer como quem atende.
import Image from 'next/image';
import { brandingDoHost } from '@/lib/dominios/branding';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const marca = await brandingDoHost();

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="flex flex-col items-center gap-6">
        {marca && (
          <div className="flex flex-col items-center gap-2">
            {marca.logoUrl && (
              // `unoptimized`: a URL e assinada e expira: passar pelo
              // otimizador do Next criaria cache de uma URL temporaria.
              <Image
                src={marca.logoUrl} alt={marca.nome} width={140} height={48} unoptimized
                className="h-12 w-auto object-contain"
              />
            )}
            <p className="text-sm text-muted-foreground">
              Área do cliente · <span className="font-medium text-foreground">{marca.nome}</span>
            </p>
            {marca.slaRespostaHoras && (
              <p className="text-xs text-muted-foreground">
                Respondemos em até {marca.slaRespostaHoras}h (horas corridas).
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
