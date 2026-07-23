// @custom — Oversight: todas as empresas da plataforma (read-only). Cross-tenant
// via service role (createAdminClient), gated por requireAdminBaluPage.
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminBaluPage } from '@/lib/admin/guard';
import { listarUsuariosPlataforma } from '@/lib/admin/users';

export const dynamic = 'force-dynamic';

function fmtData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
}

export default async function AdminEmpresasPage() {
  await requireAdminBaluPage();
  const admin = createAdminClient();

  const [{ data: companies }, { data: contabs }, usuarios] = await Promise.all([
    admin.from('companies')
      .select('id, nome, razao_social, cnpj, municipio, uf, user_id, contabilidade_id, created_at, deleted_at')
      .order('created_at', { ascending: false }),
    admin.from('contabilidades').select('id, nome'),
    listarUsuariosPlataforma(),
  ]);

  const nomeContab = new Map<string, string>((contabs ?? []).map((c) => [c.id, c.nome]));
  const emailDono = new Map<string, string | null>(usuarios.map((u) => [u.id, u.email]));
  const linhas = companies ?? [];

  return (
    <main className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-head font-semibold text-foreground">Empresas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todas as empresas cadastradas na plataforma ({linhas.length}).
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Empresa</th>
              <th className="px-3 py-2 font-medium">CNPJ</th>
              <th className="px-3 py-2 font-medium">Local</th>
              <th className="px-3 py-2 font-medium">Dono</th>
              <th className="px-3 py-2 font-medium">Escritório</th>
              <th className="px-3 py-2 font-medium">Criada</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-3 py-2 text-foreground">
                  <span className="font-medium">{c.nome ?? c.razao_social ?? '—'}</span>
                  {c.razao_social && c.nome && c.razao_social !== c.nome && (
                    <span className="block text-xs text-muted-foreground">{c.razao_social}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground-2">{c.cnpj ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground-2">
                  {c.municipio ? `${c.municipio}${c.uf ? `/${c.uf}` : ''}` : '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground-2">
                  {c.user_id ? (emailDono.get(c.user_id) ?? '—') : <span className="italic">sem dono</span>}
                </td>
                <td className="px-3 py-2 text-muted-foreground-2">
                  {c.contabilidade_id ? (nomeContab.get(c.contabilidade_id) ?? '—') : '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground-2">{fmtData(c.created_at)}</td>
                <td className="px-3 py-2">
                  {c.deleted_at ? (
                    <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">arquivada</span>
                  ) : (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">ativa</span>
                  )}
                </td>
              </tr>
            ))}
            {linhas.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Nenhuma empresa cadastrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
