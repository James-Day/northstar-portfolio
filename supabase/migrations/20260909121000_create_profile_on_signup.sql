create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_profile_on_signup on auth.users;

create trigger create_profile_on_signup
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();
