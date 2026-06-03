import { describe, it, expect } from 'vitest';
import { parseFiltrosFromParams, filtrosToQueryString } from './notas-filtros';
import { primeiroDiaMesISO, ultimoDiaMesISO } from '@/lib/format/mes-vigente';

describe('parseFiltrosFromParams', () => {
  it('sem params → mês vigente + defaults', () => {
    const f = parseFiltrosFromParams(new URLSearchParams(''));
    expect(f).toEqual({
      q: '',
      tipo: 'todos',
      status: 'todos',
      start: primeiroDiaMesISO(),
      end: ultimoDiaMesISO(),
      page: 1,
    });
  });

  it('com params explícitos → respeita', () => {
    const f = parseFiltrosFromParams(
      new URLSearchParams('q=acme&tipo=NFe&status=ativa&start=2026-01-01&end=2026-03-31&page=2'),
    );
    expect(f).toEqual({
      q: 'acme',
      tipo: 'NFe',
      status: 'ativa',
      start: '2026-01-01',
      end: '2026-03-31',
      page: 2,
    });
  });

  it('periodo=all → período vazio explícito (não cai no default)', () => {
    const f = parseFiltrosFromParams(new URLSearchParams('periodo=all'));
    expect(f.start).toBeNull();
    expect(f.end).toBeNull();
  });

  it('page ausente → 1; inválida/<1 → 1; válida → número', () => {
    expect(parseFiltrosFromParams(new URLSearchParams('')).page).toBe(1);
    expect(parseFiltrosFromParams(new URLSearchParams('page=0')).page).toBe(1);
    expect(parseFiltrosFromParams(new URLSearchParams('page=abc')).page).toBe(1);
    expect(parseFiltrosFromParams(new URLSearchParams('page=3')).page).toBe(3);
  });
});

describe('filtrosToQueryString', () => {
  it('omite defaults de q/tipo/status/page; inclui período como datas', () => {
    const qs = filtrosToQueryString({
      q: '',
      tipo: 'todos',
      status: 'todos',
      start: '2026-01-01',
      end: '2026-03-31',
      page: 1,
    });
    const sp = new URLSearchParams(qs);
    expect(sp.get('q')).toBeNull();
    expect(sp.get('tipo')).toBeNull();
    expect(sp.get('status')).toBeNull();
    expect(sp.get('page')).toBeNull();
    expect(sp.get('start')).toBe('2026-01-01');
    expect(sp.get('end')).toBe('2026-03-31');
  });

  it('período vazio → periodo=all; page>1 vira param', () => {
    const qs = filtrosToQueryString({ q: '', tipo: 'todos', status: 'todos', start: null, end: null, page: 2 });
    const sp = new URLSearchParams(qs);
    expect(sp.get('periodo')).toBe('all');
    expect(sp.get('page')).toBe('2');
  });

  it('round-trip parse→stringify→parse é estável', () => {
    const original = parseFiltrosFromParams(
      new URLSearchParams('q=x&tipo=NFSe&status=erro&start=2026-02-01&end=2026-02-28&page=4'),
    );
    const round = parseFiltrosFromParams(new URLSearchParams(filtrosToQueryString(original)));
    expect(round).toEqual(original);
  });
});
