// @custom — Resolve ambiente Serpro (trial|prod) e inputs de demonstração do Trial.
import type { SerproEnv } from '@/lib/clients/serpro';

export function resolveSerproEnv(): SerproEnv {
  return process.env.SERPRO_ENV === 'prod' ? 'prod' : 'trial';
}

/** Entradas de demonstração aceitas pelo Trial do Serpro (PGMEI). */
export function demoInputs(): { cnpj: string; periodo: string } {
  return { cnpj: '00000000000100', periodo: '201901' };
}
