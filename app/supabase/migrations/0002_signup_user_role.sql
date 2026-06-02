-- Customização 0002: criar registro de tipo de conta após o cadastro.
-- O form de cadastro envia o valor escolhido em raw_user_meta_data->>'role_type'
-- com valores 'Empresa' | 'Contador' (ausente quando não selecionado).
-- Este trigger lê esse metadata e cria o registro em role_type.
--
-- TODO (edição manual):
--   - confirmar o nome da tabela: role_type vs role_types
--   - ajustar o cast ::<enum> conforme o tipo da coluna `type`

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.role_types (
    user_id,
    type
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'type',
      'Empresa'
    )::user_types
  );

  return new;
end;
$$;


create trigger on_auth_user_created_role
after insert on auth.users
for each row
execute function public.handle_new_user_role();
