-- 0105 — encerramento do atendimento por inatividade, depois de um agradecimento.
--
-- PEDIDO DO USUARIO (25/08/2026), depois do teste de ponta a ponta:
--
--   "se o usuário agradece, ela responde ao agradecimento; depois disso, se não
--    houver interação dentro de 5 minutos, a IA agradece o contato e diz que
--    está à disposição para quando o usuário precisar, e depois encerra o
--    atendimento"
--
-- ESCOPO, escolhido pelo usuario entre duas leituras: o relogio SO e armado
-- por um agradecimento. Conversa que simplesmente para no meio NAO e encerrada
-- — 5 minutos e pouco para o ritmo do WhatsApp, e despedir-se de quem ainda
-- esta lendo uma resposta longa seria pior que nao fazer nada.
--
-- ─── AS DUAS COLUNAS ───────────────────────────────────────────────────────
--
-- `encerrar_em`  — quando o relogio vence. Gravado pelo webhook no momento em
--                  que ele responde a um agradecimento. NULL = relogio nao
--                  armado, que e o estado da esmagadora maioria das linhas.
-- `encerrado_em` — quando a despedida foi enviada. NULL enquanto nao foi.
--
-- Duas colunas, e nao um `status`: o cron precisa distinguir "armado e ainda
-- nao venceu" de "ja despedi" sem interpretar texto, e um indice parcial sobre
-- as duas deixa a varredura de minuto em minuto custar quase nada.

begin;

alter table public.whatsapp_atendimentos
  add column if not exists encerrar_em  timestamptz,
  add column if not exists encerrado_em timestamptz;

comment on column public.whatsapp_atendimentos.encerrar_em is
  'Quando o atendimento deve ser encerrado por inatividade. Armado ao responder um agradecimento; NULL = sem relogio.';
comment on column public.whatsapp_atendimentos.encerrado_em is
  'Quando a despedida foi enviada. NULL = ainda nao encerrado.';

-- O indice que o cron usa. PARCIAL de proposito: so as linhas armadas e ainda
-- abertas entram nele. Sem o `where`, o indice cresceria com a tabela inteira
-- para servir uma consulta que quase sempre devolve zero linhas.
create index if not exists whatsapp_atendimentos_encerrar_idx
  on public.whatsapp_atendimentos (encerrar_em)
  where encerrar_em is not null and encerrado_em is null;

-- ─── O INQUILINO NAO ESCREVE NENHUMA DAS DUAS ──────────────────────────────
--
-- `whatsapp_atendimentos` TEM policy de escrita para o inquilino:
--
--   [UPDATE] whatsapp_atendimentos_update_escritorio {public}
--            USING (contabilidade_id = minha_contabilidade_membro())
--
-- Ela e legitima — e por ela que o membro do escritorio marca o atendimento
-- como tratado em /contador/atendimentos (`atendido_em`, `atendido_por`,
-- `resolvido`). Mas o GRANT e de TABELA, nao de coluna: coluna nova nasce
-- gravavel por quem ja podia dar UPDATE na linha.
--
-- Sem a trava abaixo, um membro do escritorio poderia adiar indefinidamente o
-- encerramento de um cliente dele (ou disparar a despedida na hora) escrevendo
-- direto pelo PostgREST. Nao e roubo de dado alheio — e dentro do proprio
-- inquilino — mas e escrita que nenhuma tela oferece e que ninguem audita, que
-- e a definicao de superficie esquecida. Mesmo padrao da 0100 em `profiles`.

CREATE OR REPLACE FUNCTION public.tg_whatsapp_trava_encerramento()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- O webhook e o cron passam: os dois usam service_role.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- `IS DISTINCT FROM` e nao `<>`: com NULL dos dois lados `<>` devolve NULL, o
  -- IF nao dispara, e o gate passaria em silencio justamente no estado inicial
  -- (que aqui e o estado da esmagadora maioria das linhas).
  IF NEW.encerrar_em  IS DISTINCT FROM OLD.encerrar_em
     OR NEW.encerrado_em IS DISTINCT FROM OLD.encerrado_em
  THEN
    RAISE EXCEPTION
      'COLUNA_TRAVADA: encerrar_em/encerrado_em sao escritas pelo backend (webhook e cron), nao pela sessao';
  END IF;

  RETURN NEW;
END $$;

-- SECURITY INVOKER (o padrao): DEFINER faria `current_user` virar o dono da
-- funcao para todo mundo, e o gate liberaria geral. A 0100 registrou isso; nao
-- vale reaprender.
DROP TRIGGER IF EXISTS tg_whatsapp_trava_encerramento ON public.whatsapp_atendimentos;
CREATE TRIGGER tg_whatsapp_trava_encerramento
  BEFORE UPDATE ON public.whatsapp_atendimentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_whatsapp_trava_encerramento();

do $$
declare v_cols int; v_tg int; v_definer int;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='whatsapp_atendimentos'
     and column_name in ('encerrar_em','encerrado_em');
  if v_cols <> 2 then
    raise exception 'CHECK 1 falhou: esperadas 2 colunas novas, encontradas %', v_cols;
  end if;

  if not exists (select 1 from pg_indexes
     where schemaname='public' and indexname='whatsapp_atendimentos_encerrar_idx') then
    raise exception 'CHECK 2 falhou: indice parcial nao criado';
  end if;

  select count(*) into v_tg from pg_trigger
   where tgrelid='public.whatsapp_atendimentos'::regclass
     and tgname='tg_whatsapp_trava_encerramento';
  if v_tg <> 1 then
    raise exception 'CHECK 3 falhou: trigger de trava ausente';
  end if;

  select count(*) into v_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='tg_whatsapp_trava_encerramento' and p.prosecdef;
  if v_definer <> 0 then
    raise exception 'CHECK 4 falhou: a trava ficou SECURITY DEFINER — o gate liberaria geral';
  end if;

  raise notice '0105 ok — duas colunas, indice parcial, trava INVOKER de pe';
end $$;

commit;
