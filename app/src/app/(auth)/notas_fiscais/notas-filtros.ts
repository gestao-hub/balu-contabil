import { primeiroDiaMesISO, ultimoDiaMesISO } from '@/lib/format/mes-vigente';

export type Filtros = {
  q: string;
  tipo: string;     // 'todos' default
  status: string;   // 'todos' default
  start: string | null;
  end: string | null;
  page: number;     // 1 default
};

type ParamsLike = { get(key: string): string | null };

// Sem params de período → mês vigente (primeira visita). `periodo=all` → vazio
// explícito (usuário limpou). start/end presentes → usa-os.
export function parseFiltrosFromParams(sp: ParamsLike): Filtros {
  const q = sp.get('q') ?? '';
  const tipo = sp.get('tipo') ?? 'todos';
  const status = sp.get('status') ?? 'todos';

  let start: string | null;
  let end: string | null;
  const periodo = sp.get('periodo');
  const rawStart = sp.get('start');
  const rawEnd = sp.get('end');
  if (periodo === 'all') {
    start = null;
    end = null;
  } else if (rawStart || rawEnd) {
    start = rawStart;
    end = rawEnd;
  } else {
    start = primeiroDiaMesISO();
    end = ultimoDiaMesISO();
  }

  const pageRaw = Number.parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return { q, tipo, status, start, end, page };
}

export function filtrosToQueryString(f: Filtros): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set('q', f.q);
  if (f.tipo !== 'todos') sp.set('tipo', f.tipo);
  if (f.status !== 'todos') sp.set('status', f.status);
  // O mês vigente é o default (parse cai nele sem params), então o omitimos pra não
  // "congelar" o mês na URL (bookmark/voltar depois de virar o mês traria o mês velho).
  const ehMesVigente = f.start === primeiroDiaMesISO() && f.end === ultimoDiaMesISO();
  if (ehMesVigente) {
    // omite — re-parse deriva o mês vigente atual
  } else if (f.start || f.end) {
    if (f.start) sp.set('start', f.start);
    if (f.end) sp.set('end', f.end);
  } else {
    sp.set('periodo', 'all');
  }
  if (f.page > 1) sp.set('page', String(f.page));
  return sp.toString();
}
