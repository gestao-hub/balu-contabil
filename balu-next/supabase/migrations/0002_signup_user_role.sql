-- Customização 0002: persistir o tipo de conta escolhido no cadastro.
-- O form de cadastro envia `user_role` em raw_user_meta_data; o trigger
-- handle_new_user passa a copiá-lo para profiles.user_role.
-- Valores inválidos ou ausentes caem no default 'empresa' (mesma constraint da 0001).

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
declare
  v_role text := new.raw_user_meta_data->>'user_role';
begin
  if v_role is null or v_role not in ('empresa', 'contador') then
    v_role := 'empresa';
  end if;

  insert into public.profiles (id, user_role)
  values (new.id, v_role)
  on conflict do nothing;

  return new;
end; $$;
