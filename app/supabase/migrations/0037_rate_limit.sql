-- 0037: rate limiting atômico por janela (Bloco E, item 7). Só service_role acessa
-- (a RPC é SECURITY DEFINER e é chamada pelo admin client nas server actions/rotas).
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  chave text NOT NULL,
  janela_inicio timestamptz NOT NULL,
  contador int NOT NULL DEFAULT 0,
  PRIMARY KEY (chave, janela_inicio)
);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.rate_limit_hits TO service_role;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_chave text, p_max int, p_janela_segs int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_janela timestamptz := to_timestamp(floor(extract(epoch FROM now()) / p_janela_segs) * p_janela_segs);
  v_contador int;
BEGIN
  INSERT INTO rate_limit_hits (chave, janela_inicio, contador)
    VALUES (p_chave, v_janela, 1)
    ON CONFLICT (chave, janela_inicio)
    DO UPDATE SET contador = rate_limit_hits.contador + 1
    RETURNING contador INTO v_contador;
  -- poda oportunista de janelas velhas (best-effort)
  DELETE FROM rate_limit_hits WHERE janela_inicio < now() - interval '1 day';
  RETURN v_contador <= p_max;
END $$;
REVOKE ALL ON FUNCTION public.check_rate_limit(text,int,int) FROM public;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text,int,int) TO service_role;
