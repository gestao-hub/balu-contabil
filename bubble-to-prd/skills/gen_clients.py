#!/usr/bin/env python3
"""
gen_clients.py — Emite clientes API tipados a partir do slice de api_connector.

Lê:
    slices/07_api_connector.json

Escreve em <out>/src/lib/:
    supabase/server.ts        — wrapper @supabase/ssr (server)
    supabase/browser.ts       — wrapper @supabase/ssr (browser)
    clients/focus-nfe.ts      — Focus NFe (NFe, NFCe, NFSe, consulta CNPJ)
    clients/serpro.ts         — Integra Contador (Declarar/Emitir/Consultar)
    clients/n8n.ts            — webhooks do motor fiscal
    clients/index.ts          — barrel + ENDPOINTS catalog

Uso:
    python3 gen_clients.py ../slices ../../balu-next
"""
from __future__ import annotations
import json, sys, re
from pathlib import Path
from collections import defaultdict


def host_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url or "")
    return m.group(1) if m else ""


def normalize(name: str) -> str:
    n = re.sub(r"[^A-Za-z0-9]+", "_", name or "")
    n = re.sub(r"_+", "_", n).strip("_")
    if not n: return "call"
    if n[0].isdigit(): n = "_" + n
    # camelCase
    parts = n.split("_")
    return parts[0].lower() + "".join(p[:1].upper() + p[1:].lower() for p in parts[1:])


def main():
    if len(sys.argv) < 3:
        print("Uso: gen_clients.py <slices_dir> <out_dir>"); sys.exit(1)
    slices = Path(sys.argv[1])
    out = Path(sys.argv[2])
    lib = out / "src" / "lib"
    (lib / "supabase").mkdir(parents=True, exist_ok=True)
    (lib / "clients").mkdir(parents=True, exist_ok=True)

    # ── Supabase SSR wrappers ──
    (lib / "supabase" / "server.ts").write_text("""import { createServerClient as create } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerClient() {
  const store = await cookies();
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookiesToSet) => {
          try { cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
        },
      },
    }
  );
}
""")
    (lib / "supabase" / "browser.ts").write_text("""import { createBrowserClient as create } from '@supabase/ssr';
export const createBrowserClient = () =>
  create(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
""")
    print(f"  ✓ {lib/'supabase/server.ts'}")
    print(f"  ✓ {lib/'supabase/browser.ts'}")

    # ── carrega calls e agrupa por host ──
    calls = json.loads((slices / "07_api_connector.json").read_text())
    by_host = defaultdict(list)
    for c in calls:
        by_host[host_of(c.get("url") or "")].append(c)

    # Detectar Focus, Serpro, n8n
    focus = []
    serpro = []
    n8n = []
    for h, cs in by_host.items():
        if "focusnfe.com.br" in h: focus.extend(cs)
        elif "apiserpro.serpro.gov.br" in h: serpro.extend(cs)
        elif "webhooks.envia.click" in h: n8n.extend(cs)

    # ── Focus client ──
    lines = [
        "// Auto-gerado — Cliente Focus NFe (emissão NF-e / NFC-e / NFS-e + consulta CNPJ)",
        "// Secrets NUNCA vão pro frontend. Este módulo só é importável no server.",
        "import 'server-only';",
        "",
        "const PROD = 'https://api.focusnfe.com.br';",
        "const HOM  = 'https://homologacao.focusnfe.com.br';",
        "const base = (env: 'prod' | 'hom') => (env === 'prod' ? PROD : HOM);",
        "",
        "function auth() {",
        "  const token = process.env.FOCUS_NFE_TOKEN!;",
        "  return 'Basic ' + Buffer.from(token + ':').toString('base64');",
        "}",
        "",
        "async function call<T>(env: 'prod' | 'hom', method: string, path: string, body?: unknown): Promise<T> {",
        "  const res = await fetch(`${base(env)}${path}`, {",
        "    method, headers: { Authorization: auth(), 'Content-Type': 'application/json' },",
        "    body: body ? JSON.stringify(body) : undefined,",
        "    cache: 'no-store',",
        "  });",
        "  if (!res.ok) throw new Error(`Focus ${method} ${path} → ${res.status}: ${await res.text()}`);",
        "  return res.json() as Promise<T>;",
        "}",
        "",
        "export const focus = {",
        "  /** GET /v2/cnpjs/:cnpj — consulta dados de empresa */",
        "  consultarCnpj: (cnpj: string, env: 'prod'|'hom' = 'prod') =>",
        "    call<Record<string, unknown>>(env, 'GET', `/v2/cnpjs/${cnpj}`),",
        "  /** POST /v2/nfe?ref=:ref — emissão NFe (idempotente por ref) */",
        "  emitirNfe: (ref: string, payload: unknown, env: 'prod'|'hom' = 'hom') =>",
        "    call<Record<string, unknown>>(env, 'POST', `/v2/nfe?ref=${encodeURIComponent(ref)}`, payload),",
        "  /** POST /v2/nfce?ref=:ref */",
        "  emitirNfce: (ref: string, payload: unknown, env: 'prod'|'hom' = 'hom') =>",
        "    call<Record<string, unknown>>(env, 'POST', `/v2/nfce?ref=${encodeURIComponent(ref)}`, payload),",
        "  /** POST /v2/nfsen?ref=:ref */",
        "  emitirNfse: (ref: string, payload: unknown, env: 'prod'|'hom' = 'hom') =>",
        "    call<Record<string, unknown>>(env, 'POST', `/v2/nfsen?ref=${encodeURIComponent(ref)}`, payload),",
        "  /** DELETE /v2/nfe/:ref — cancelar (motivo no body) */",
        "  cancelarNfe: (ref: string, justificativa: string, env: 'prod'|'hom' = 'hom') =>",
        "    call<Record<string, unknown>>(env, 'DELETE', `/v2/nfe/${encodeURIComponent(ref)}`, { justificativa }),",
        "};",
    ]
    (lib / "clients" / "focus-nfe.ts").write_text("\n".join(lines))
    print(f"  ✓ {lib/'clients/focus-nfe.ts'}  ({len(focus)} calls fonte)")

    # ── Serpro client ──
    lines = [
        "// Auto-gerado — Cliente Serpro Integra Contador (PGDAS-D, DAS, declarações)",
        "import 'server-only';",
        "",
        "const PROD = 'https://gateway.apiserpro.serpro.gov.br/integra-contador';",
        "const TRIAL = 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial';",
        "",
        "type Envelope = {",
        "  contratante: { numero: string; tipo: 1 | 2 };",
        "  autorPedidoDados: { numero: string; tipo: 1 | 2 };",
        "  contribuinte: { numero: string; tipo: 1 | 2 };",
        "  pedidoDados: { idSistema: string; idServico: string; versaoSistema?: string; dados: string };",
        "};",
        "",
        "async function bearer(): Promise<string> {",
        "  // TODO: implementar cache em memória (token vale ~60min)",
        "  const ck = process.env.SERPRO_CONSUMER_KEY!;",
        "  const cs = process.env.SERPRO_CONSUMER_SECRET!;",
        "  const res = await fetch('https://gateway.apiserpro.serpro.gov.br/token', {",
        "    method: 'POST',",
        "    headers: {",
        "      Authorization: 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),",
        "      'Content-Type': 'application/x-www-form-urlencoded',",
        "    },",
        "    body: 'grant_type=client_credentials',",
        "  });",
        "  const j = (await res.json()) as { access_token: string };",
        "  return j.access_token;",
        "}",
        "",
        "async function call<T>(env: 'prod' | 'trial', action: 'Declarar' | 'Emitir' | 'Consultar', envelope: Envelope): Promise<T> {",
        "  const base = env === 'prod' ? PROD : TRIAL;",
        "  const token = await bearer();",
        "  const res = await fetch(`${base}/v1/${action}`, {",
        "    method: 'POST',",
        "    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },",
        "    body: JSON.stringify(envelope),",
        "    cache: 'no-store',",
        "  });",
        "  if (!res.ok) throw new Error(`Serpro ${action} → ${res.status}: ${await res.text()}`);",
        "  return res.json() as Promise<T>;",
        "}",
        "",
        "export const serpro = {",
        "  transmitirDeclaracao: (env: 'prod'|'trial', envelope: Envelope) => call(env, 'Declarar', envelope),",
        "  emitirDas: (env: 'prod'|'trial', envelope: Envelope) => call(env, 'Emitir', envelope),",
        "  consultarDeclaracao: (env: 'prod'|'trial', envelope: Envelope) => call(env, 'Consultar', envelope),",
        "};",
        "",
        "/** Serviços conhecidos (idServico). */",
        "export const SERPRO_SERVICES = {",
        "  TRANS_DECLARACAO: 'TRANSDECLARACAO11',",
        "  GERAR_DAS:        'GERARDAS12',",
        "  GERAR_DAS_COBR:   'GERARDASCOBRANCA17',",
        "  GERAR_DAS_AVULSO: 'GERARDASAVULSO19',",
        "  CONS_DECLARACAO:  'CONSDECLARACAO13',",
        "  CONS_ULTIMA_DEC:  'CONSULTIMADECREC14',",
        "  OBTER_DECLARACAO: 'OBTERDECLARACAO',",
        "} as const;",
    ]
    (lib / "clients" / "serpro.ts").write_text("\n".join(lines))
    print(f"  ✓ {lib/'clients/serpro.ts'}  ({len(serpro)} calls fonte)")

    # ── n8n client ──
    lines = [
        "// Auto-gerado — Cliente n8n (motor fiscal). Cada método é um webhook.",
        "import 'server-only';",
        "const BASE = 'https://webhooks.envia.click';",
        "",
        "async function post<T>(path: string, body: unknown): Promise<T> {",
        "  const res = await fetch(`${BASE}${path}`, {",
        "    method: 'POST',",
        "    headers: { 'Content-Type': 'application/json' },",
        "    body: JSON.stringify(body),",
        "    cache: 'no-store',",
        "  });",
        "  if (!res.ok) throw new Error(`n8n ${path} → ${res.status}: ${await res.text()}`);",
        "  return res.json() as Promise<T>;",
        "}",
        "",
        "export const n8n = {",
        "  consolidarReceitas:  (p: { empresa_id: string; competencia: string }) => post('/webhook/consolidar_receitas_fiscais', p),",
        "  calcularRbt12:       (p: { empresa_id: string; competencia: string }) => post('/webhook/calcular_rbt12', p),",
        "  consultaDasMei:      (p: { empresa_id: string; competencia: string }) => post('/webhook/consulta_das_mei', p),",
        "  postAutenticacao:    (p: { empresa_id: string; consumer_key: string; consumer_secret: string }) => post('/webhook/post-autenticacao', p),",
        "  uploadCertificado:   (p: { unique_id_empresa: string; unique_id_bubble: string; file_base64: string; cert_password: string }) => post('/webhook/upload-certificado', p),",
        "};",
    ]
    (lib / "clients" / "n8n.ts").write_text("\n".join(lines))
    print(f"  ✓ {lib/'clients/n8n.ts'}  ({len(n8n)} calls fonte)")

    # ── catálogo bruto (para auditoria / depuração) ──
    catalog = [
        f"// Auto-gerado — catálogo completo de endpoints lidos do .bubble ({len(calls)} chamadas).",
        f"// Use só pra referência; cada cliente real está em ./focus-nfe, ./serpro, ./n8n.",
        "export const ENDPOINTS = [",
    ]
    for c in calls:
        n = c.get("call_name") or "?"
        m = c.get("method") or "?"
        u = c.get("url") or ""
        catalog.append(f"  {{ name: {json.dumps(n)}, method: {json.dumps(m)}, url: {json.dumps(u)} }},")
    catalog.append("] as const;")
    (lib / "clients" / "_endpoints.ts").write_text("\n".join(catalog))
    print(f"  ✓ {lib/'clients/_endpoints.ts'}  ({len(calls)} entradas)")

    # ── barrel ──
    (lib / "clients" / "index.ts").write_text("""export { focus } from './focus-nfe';
export { serpro, SERPRO_SERVICES } from './serpro';
export { n8n } from './n8n';
export { ENDPOINTS } from './_endpoints';
""")
    print(f"  ✓ {lib/'clients/index.ts'}")


if __name__ == "__main__":
    main()
