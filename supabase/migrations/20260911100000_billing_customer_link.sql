-- Checkout creates the Stripe customer. Link that server-observed customer to
-- the authenticated owner before applying lifecycle events so Billing Portal
-- can only operate on the account's own customer.
create or replace function public.link_stripe_customer(
  p_user_id uuid,
  p_customer_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  if p_user_id is null then
    raise exception 'Billing user is required.' using errcode = '22023';
  end if;
  if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'Stripe customer ID is invalid.' using errcode = '22023';
  end if;

  select user_id into v_owner
    from public.billing_customers
   where stripe_customer_id = p_customer_id
   limit 1;
  if v_owner is not null and v_owner <> p_user_id then
    raise exception 'Stripe customer is already linked to another account.' using errcode = '23505';
  end if;

  insert into public.billing_customers (user_id, stripe_customer_id)
  values (p_user_id, p_customer_id)
  on conflict (user_id) do update
    set stripe_customer_id = excluded.stripe_customer_id,
        updated_at = now()
    where public.billing_customers.stripe_customer_id is null
       or public.billing_customers.stripe_customer_id = excluded.stripe_customer_id;
end;
$$;

revoke all on function public.link_stripe_customer(uuid, text) from public;
grant execute on function public.link_stripe_customer(uuid, text) to service_role;
