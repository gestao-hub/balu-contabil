// @custom — Oversight: todos os usuários da plataforma (read-only). Papel via
// role_types (fonte canônica); e-mail/confirmação via GoTrue admin API.
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { listarUsuariosPlataforma } from '@/lib/admin/users';

export const dynamic = 'force-dynamic';

function fmtData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

const PAPEL_LABEL: Record<string, string> = {
  adminbalu: 'Admin Balu', contador: 'Contador', empresa: 'Empresa',
};

export default async function AdminUsuariosPage() {
  await requireAdminBaluPage();
  const usuarios = await listarUsuariosPlataforma();

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">Usuários</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todos os usuários da plataforma ({usuarios.length}).
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">E-mail</th>
              <th className="px-3 py-2 font-medium">Papel</th>
              <th className="px-3 py-2 font-medium">Criado</th>
              <th className="px-3 py-2 font-medium">E-mail confirmado</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const papel = (u.papel ?? '').toLowerCase();
              return (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2 text-foreground">{u.email ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground-2">
                    {papel ? (PAPEL_LABEL[papel] ?? u.papel) : <span className="italic">sem papel</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground-2">{fmtData(u.criadoEm)}</td>
                  <td className="px-3 py-2">
                    {u.emailConfirmado ? (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">sim</span>
                    ) : (
                      <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">pendente</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {usuarios.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Nenhum usuário.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
