import { competenciaReferenciaBrt, competenciaAddMonths } from '@/lib/fiscal/guia';
import ApuracaoWizard from './ApuracaoWizard';

export default function NovaApuracaoPage() {
  const competenciaDefault = competenciaAddMonths(competenciaReferenciaBrt(new Date()), -1);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold text-foreground">Nova apuração</h1>
      <ApuracaoWizard competenciaDefault={competenciaDefault} />
    </div>
  );
}
