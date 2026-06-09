-- Confirma manualmente o e-mail de um usuário (Supabase Auth / GoTrue).
-- Uso: cole no SQL Editor do Supabase, troque o UUID nos dois lugares e rode.
--
-- Observações:
--   - `confirmed_at` é coluna GERADA a partir de email_confirmed_at — NÃO edite.
--   - Só seta se ainda estiver NULL (idempotente: rodar de novo não faz nada).

update auth.users
set
  email_confirmed_at = now(),
  confirmation_token = '',   -- invalida o token de confirmação pendente
  updated_at = now()
where id = '00000000-0000-0000-0000-000000000000'::uuid   -- ⬅️ troque pelo UUID do usuário
  and email_confirmed_at is null;

-- Confirma o resultado:
select id, email, email_confirmed_at, confirmed_at
from auth.users
where id = '00000000-0000-0000-0000-000000000000'::uuid;  -- ⬅️ mesmo UUID
