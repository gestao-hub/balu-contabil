// src/lib/abertura/minuta/templates.ts
// Renderiza a minuta (HTML pronto para "Salvar como PDF") por tipo de documento.
// TODO valor interpolado passa por esc() — previne HTML quebrado/injeção.
import type { TipoDocMinuta } from './index';

type Row = Record<string, any>;

// Escapa & < > " ' para entidades HTML. Nulos/undefined viram string vazia aqui;
// o placeholder de exibição é decidido por val()/valLinha().
function esc(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Valor escapado ou travessão quando ausente (para exibição de dados).
function val(v: unknown): string {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return '—';
  return esc(v);
}

// Valor escapado ou placeholder de preenchimento manual (para campos de formulário/ato).
function slot(v: unknown): string {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return '_____';
  return esc(v);
}

// Junta uma lista de valores (arrays text[]) com vírgula, escapando cada item.
function lista(v: unknown): string {
  if (Array.isArray(v)) {
    const items = v.filter((x) => x != null && String(x).trim() !== '');
    if (items.length === 0) return '—';
    return items.map((x) => esc(x)).join(', ');
  }
  return val(v);
}

// Formata numeric(15,2) como BRL. null/NaN → placeholder.
function brl(v: unknown): string {
  if (v == null) return '_____';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '_____';
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slug(v: unknown): string {
  return String(v ?? 'empresa')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'empresa';
}

// Endereço do titular montado (para requerimento).
function enderecoTitular(ab: Row): string {
  const partes = [
    ab.titular_logradouro, ab.titular_numero, ab.titular_complemento,
    ab.titular_bairro, ab.titular_cidade, ab.titular_uf, ab.titular_cep,
  ].filter((x) => x != null && String(x).trim() !== '');
  if (partes.length === 0) return '_____';
  return partes.map((x) => esc(x)).join(', ');
}

function enderecoSede(ab: Row): string {
  const partes = [
    ab.sede_logradouro, ab.sede_numero, ab.sede_complemento,
    ab.sede_bairro, ab.sede_cidade, ab.sede_uf, ab.sede_cep,
  ].filter((x) => x != null && String(x).trim() !== '');
  if (partes.length === 0) return '_____';
  return partes.map((x) => esc(x)).join(', ');
}

const MARCA_MINUTA = 'MINUTA — rascunho sujeito a revisão do contador responsável. Não é documento registrado.';

// Wrapper HTML comum: charset, CSS de impressão A4 serif, título, corpo, rodapé de marca.
function wrapper(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  :root { --tinta: #1a1a1a; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", Georgia, serif;
    color: var(--tinta);
    background: #f4f4f4;
    font-size: 12pt;
    line-height: 1.5;
  }
  .folha {
    background: #fff;
    max-width: 21cm;
    min-height: 29.7cm;
    margin: 1cm auto;
    padding: 2.5cm 2.5cm 3.5cm;
    box-shadow: 0 0 8px rgba(0,0,0,.15);
    position: relative;
  }
  h1 { font-size: 15pt; text-align: center; text-transform: uppercase; margin: 0 0 .3rem; }
  h2 { font-size: 12.5pt; margin: 1.4rem 0 .4rem; }
  .sub { text-align: center; font-size: 10.5pt; color: #444; margin: 0 0 1.4rem; }
  p { margin: 0 0 .7rem; text-align: justify; }
  dl { margin: 0 0 .7rem; }
  dt { font-weight: bold; margin-top: .5rem; }
  dd { margin: 0 0 .2rem; }
  ol.clausulas { padding-left: 1.2rem; }
  ol.clausulas > li { margin-bottom: .7rem; text-align: justify; }
  .assinatura { margin-top: 3.5rem; text-align: center; }
  .assinatura .linha { border-top: 1px solid var(--tinta); width: 60%; margin: 2.5rem auto .3rem; }
  .marca {
    margin-top: 2.5rem;
    padding: .6rem .8rem;
    border: 1px dashed #b00;
    color: #b00;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt;
    text-align: center;
    letter-spacing: .02em;
  }
  .rodape-fixo { display: none; }
  @media print {
    body { background: #fff; font-size: 12pt; }
    .folha { box-shadow: none; margin: 0; max-width: none; min-height: auto; padding: 1.8cm 2cm 2.2cm; }
    .marca { position: fixed; bottom: .4cm; left: 2cm; right: 2cm; }
    @page { size: A4; margin: 0; }
  }
</style>
</head>
<body>
<div class="folha">
${corpo}
<div class="marca">${esc(MARCA_MINUTA)}</div>
</div>
</body>
</html>`;
}

function renderRoteiroMei(ab: Row): string {
  const titulo = 'Roteiro de Conferência — MEI';
  const corpo = `
<h1>Roteiro de Conferência — MEI</h1>
<p class="sub">Documento interno de conferência de dados. Não é ato constitutivo.</p>

<p>Este roteiro reúne os dados informados para a formalização como <strong>Microempreendedor
Individual (MEI)</strong>. O registro do MEI é <strong>automático</strong> no Portal do Empreendedor
(art. 18-A da Lei Complementar nº 123/2006), sendo o <strong>Certificado da Condição de
Microempreendedor Individual (CCMEI)</strong> emitido pelo próprio Portal. Não há contrato social
ou ato constitutivo a registrar em Junta Comercial.</p>

<h2>1. Dados do titular</h2>
<dl>
  <dt>Nome completo</dt><dd>${val(ab.titular_nome_completo)}</dd>
  <dt>CPF</dt><dd>${val(ab.titular_cpf)}</dd>
  <dt>RG</dt><dd>${val(ab.titular_rg_numero)} — ${val(ab.titular_rg_orgao_emissor)}/${val(ab.titular_rg_uf)}</dd>
  <dt>Nacionalidade / Estado civil</dt><dd>${val(ab.titular_nacionalidade)} — ${val(ab.titular_estado_civil)}</dd>
  <dt>Endereço do titular</dt><dd>${enderecoTitular(ab)}</dd>
</dl>

<h2>2. Empresa pretendida</h2>
<dl>
  <dt>Razão social</dt><dd>${val(ab.empresa_razao_social_1)}</dd>
  <dt>Nome fantasia</dt><dd>${val(ab.empresa_nome_fantasia)}</dd>
  <dt>Objeto / atividade</dt><dd>${val(ab.empresa_objeto_social)}</dd>
  <dt>CNAE principal</dt><dd>${val(ab.empresa_cnae_principal)}</dd>
  <dt>CNAEs secundários</dt><dd>${lista(ab.empresa_cnaes_secundarios)}</dd>
  <dt>Regime tributário</dt><dd>${val(ab.empresa_regime_tributario)}</dd>
</dl>

<h2>3. Sede</h2>
<dl>
  <dt>Endereço da sede</dt><dd>${enderecoSede(ab)}</dd>
</dl>

<p><strong>Próximo passo:</strong> conferir os dados acima e concluir a formalização no
Portal do Empreendedor (gov.br), de onde será emitido o CCMEI.</p>
`;
  return wrapper(titulo, corpo);
}

function renderRequerimentoEmpresario(ab: Row): string {
  const titulo = 'Requerimento de Empresário (minuta)';
  const corpo = `
<h1>Requerimento de Empresário</h1>
<p class="sub">Minuta conforme modelo DREI — Lei nº 6.015/1973 e Instrução Normativa DREI vigente.</p>

<p>Eu, <strong>${slot(ab.titular_nome_completo)}</strong>, nacionalidade
${slot(ab.titular_nacionalidade)}, estado civil ${slot(ab.titular_estado_civil)},
inscrito(a) no CPF sob o nº ${slot(ab.titular_cpf)}, portador(a) da Cédula de Identidade RG nº
${slot(ab.titular_rg_numero)}, expedida por ${slot(ab.titular_rg_orgao_emissor)}/${slot(ab.titular_rg_uf)},
residente e domiciliado(a) em ${enderecoTitular(ab)}, requer a inscrição como
<strong>EMPRESÁRIO INDIVIDUAL</strong>, declarando não estar impedido(a) de exercer atividade
empresária e não possuir outro registro de empresário, nos seguintes termos:</p>

<dl>
  <dt>Nome empresarial (firma)</dt><dd>${slot(ab.empresa_razao_social_1)}</dd>
  <dt>Nome fantasia</dt><dd>${val(ab.empresa_nome_fantasia)}</dd>
  <dt>Objeto (atividade econômica)</dt><dd>${slot(ab.empresa_objeto_social)}</dd>
  <dt>CNAE principal</dt><dd>${val(ab.empresa_cnae_principal)}</dd>
  <dt>CNAEs secundários</dt><dd>${lista(ab.empresa_cnaes_secundarios)}</dd>
  <dt>Capital</dt><dd>${brl(ab.empresa_capital_social)}</dd>
  <dt>Endereço da sede / estabelecimento</dt><dd>${enderecoSede(ab)}</dd>
</dl>

<p>Nestes termos, requer o deferimento do registro perante a Junta Comercial competente.</p>

<div class="assinatura">
  <p>${slot(ab.sede_cidade)}, _____ de _______________ de _______.</p>
  <div class="linha"></div>
  <p>${slot(ab.titular_nome_completo)}<br>Empresário Individual</p>
</div>
`;
  return wrapper(titulo, corpo);
}

function renderAtoConstitutivoSlu(ab: Row): string {
  const titulo = 'Ato Constitutivo de Sociedade Limitada Unipessoal (minuta)';
  const corpo = `
<h1>Ato Constitutivo de Sociedade Limitada Unipessoal</h1>
<p class="sub">Minuta — SLU nos termos do art. 1.052, §§ 1º e 2º, do Código Civil, e da Instrução Normativa DREI vigente.</p>

<p><strong>${slot(ab.titular_nome_completo)}</strong>, nacionalidade
${slot(ab.titular_nacionalidade)}, estado civil ${slot(ab.titular_estado_civil)},
inscrito(a) no CPF sob o nº ${slot(ab.titular_cpf)}, portador(a) do RG nº
${slot(ab.titular_rg_numero)} — ${slot(ab.titular_rg_orgao_emissor)}/${slot(ab.titular_rg_uf)},
residente e domiciliado(a) em ${enderecoTitular(ab)}, na qualidade de <strong>titular único</strong>,
resolve constituir uma <strong>Sociedade Limitada Unipessoal (SLU)</strong>, que se regerá pelas
cláusulas seguintes:</p>

<ol class="clausulas">
  <li><strong>Cláusula 1ª — Nome empresarial e tipo.</strong> A sociedade adota o nome empresarial
  <strong>${slot(ab.empresa_razao_social_1)}</strong>, constituída sob a forma de Sociedade
  Limitada Unipessoal${ab.empresa_nome_fantasia ? `, utilizando o nome fantasia "${esc(ab.empresa_nome_fantasia)}"` : ''}.</li>

  <li><strong>Cláusula 2ª — Sede.</strong> A sociedade tem sede e foro em ${enderecoSede(ab)}.</li>

  <li><strong>Cláusula 3ª — Objeto social.</strong> A sociedade tem por objeto:
  ${slot(ab.empresa_objeto_social)}${ab.empresa_cnae_principal ? ` (CNAE principal ${esc(ab.empresa_cnae_principal)})` : ''}.</li>

  <li><strong>Cláusula 4ª — Capital social.</strong> O capital social é de
  <strong>${brl(ab.empresa_capital_social)}</strong>, totalmente subscrito e integralizado, neste ato,
  pelo titular único, em moeda corrente nacional.</li>

  <li><strong>Cláusula 5ª — Administração.</strong> A administração da sociedade caberá ao próprio
  titular, ${slot(ab.titular_nome_completo)}, que a representará ativa e passivamente, judicial e
  extrajudicialmente, autorizado o uso do nome empresarial.</li>

  <li><strong>Cláusula 6ª — Foro.</strong> Fica eleito o foro da comarca de
  ${slot(ab.sede_cidade)}/${slot(ab.sede_uf)} para dirimir quaisquer questões oriundas deste ato.</li>
</ol>

<p>E, por estar assim constituída, o titular assina o presente ato constitutivo.</p>

<div class="assinatura">
  <p>${slot(ab.sede_cidade)}, _____ de _______________ de _______.</p>
  <div class="linha"></div>
  <p>${slot(ab.titular_nome_completo)}<br>Titular único</p>
</div>
`;
  return wrapper(titulo, corpo);
}

export function renderMinuta(tipoDoc: TipoDocMinuta, ab: Row): { html: string; filename: string } {
  const razaoSlug = slug(ab.empresa_razao_social_1 ?? ab.empresa_nome_fantasia ?? 'empresa');
  let html: string;
  if (tipoDoc === 'roteiro_mei') html = renderRoteiroMei(ab);
  else if (tipoDoc === 'requerimento_empresario') html = renderRequerimentoEmpresario(ab);
  else html = renderAtoConstitutivoSlu(ab);
  const filename = `minuta-${tipoDoc}-${razaoSlug}.html`;
  return { html, filename };
}
