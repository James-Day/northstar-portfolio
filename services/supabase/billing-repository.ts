import { z } from "zod";
import type { BillingPersistence } from "@/services/billing/persistence";
import type {
  BillingWebhook,
  Entitlement,
  EntitlementStatus,
} from "@/services/billing/entitlements";

const customerSchema = z.object({
  user_id: z.string().uuid(),
  entitlement_status: z.enum([
    "inactive",
    "trialing",
    "active",
    "past_due",
    "canceled",
  ]),
  trial_started_at: z.string().nullable(),
  trial_ends_at: z.string().nullable(),
  last_webhook_created_at: z.string().nullable().optional(),
  last_webhook_id: z.string().nullable().optional(),
});

export type SupabaseBillingRepositoryOptions = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  serviceRoleKey?: string;
  fetcher?: typeof fetch;
};

/**
 * Keeps billing mutations behind RPCs so trial creation and webhook delivery
 * history can be committed together with the entitlement row.
 */
export class SupabaseBillingRepository implements BillingPersistence {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: SupabaseBillingRepositoryOptions) {
    this.baseUrl = new URL(options.supabaseUrl);
    if (!options.supabaseAnonKey.trim())
      throw new Error("SUPABASE_ANON_KEY is required for billing reads.");
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async getEntitlement(
    userId: string,
    accessToken: string,
  ): Promise<Entitlement | undefined> {
    const url = new URL("/rest/v1/billing_customers", this.baseUrl);
    url.searchParams.set("user_id", `eq.${userId}`);
    url.searchParams.set(
      "select",
      "user_id,entitlement_status,trial_started_at,trial_ends_at,last_webhook_created_at,last_webhook_id",
    );
    url.searchParams.set("limit", "1");
    const response = await this.fetcher(url, {
      headers: this.userHeaders(accessToken),
    });
    if (!response.ok)
      throw new Error(
        `Supabase billing entitlement query failed with HTTP ${response.status}.`,
      );
    const rows = z.array(customerSchema).parse(await response.json());
    if (!rows[0]) return undefined;
    return mapCustomer(rows[0], userId);
  }

  async startTrialAfterCommittedImport(
    userId: string,
    accessToken: string,
  ): Promise<Entitlement | undefined> {
    const response = await this.rpc(
      "start_trial_after_committed_import",
      {},
      this.userHeaders(accessToken),
    );
    const rows = z.array(customerSchema).parse(await response.json());
    if (!rows[0]) return this.getEntitlement(userId, accessToken);
    return mapCustomer(rows[0], userId);
  }

  async applyVerifiedWebhook(
    userId: string,
    event: BillingWebhook,
    payload: Record<string, unknown> = {},
  ): Promise<Entitlement> {
    if (!this.options.serviceRoleKey?.trim())
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is required for billing webhook writes.",
      );
    const response = await this.rpc(
      "apply_billing_webhook",
      {
        p_user_id: userId,
        p_event_id: event.id,
        p_event_type: event.type,
        p_event_created_at: event.createdAt.toISOString(),
        p_payload: payload,
      },
      this.serviceHeaders(),
    );
    const rows = z.array(customerSchema).parse(await response.json());
    if (!rows[0])
      throw new Error(
        "Supabase did not return the billing entitlement after webhook application.",
      );
    return mapCustomer(rows[0], userId);
  }

  /**
   * Looks up ownership using the service-only Stripe customer mapping. This
   * is intentionally separate from the user-scoped entitlement read so a
   * webhook cannot select a billing row through a caller supplied user id.
   */
  async findUserIdByStripeCustomerId(
    customerId: string,
  ): Promise<string | undefined> {
    if (!this.options.serviceRoleKey?.trim())
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is required for Stripe customer lookup.",
      );
    const url = new URL("/rest/v1/billing_customers", this.baseUrl);
    url.searchParams.set("stripe_customer_id", `eq.${customerId}`);
    url.searchParams.set("select", "user_id");
    url.searchParams.set("limit", "1");
    const response = await this.fetcher(url, {
      headers: this.serviceHeaders(),
    });
    if (!response.ok)
      throw new Error(
        `Supabase Stripe customer lookup failed with HTTP ${response.status}.`,
      );
    const rows = z
      .array(z.object({ user_id: z.string().uuid() }))
      .parse(await response.json());
    return rows[0]?.user_id;
  }

  /** Resolve the server-owned Stripe customer for a signed-in user. */
  async findStripeCustomerIdByUserId(
    userId: string,
    accessToken: string,
  ): Promise<string | undefined> {
    const url = new URL("/rest/v1/billing_customers", this.baseUrl);
    url.searchParams.set("user_id", `eq.${userId}`);
    url.searchParams.set("select", "stripe_customer_id");
    url.searchParams.set("limit", "1");
    const response = await this.fetcher(url, {
      headers: this.userHeaders(accessToken),
    });
    if (!response.ok)
      throw new Error(
        `Supabase Stripe customer query failed with HTTP ${response.status}.`,
      );
    const rows = z
      .array(z.object({ stripe_customer_id: z.string().nullable() }))
      .parse(await response.json());
    return rows[0]?.stripe_customer_id ?? undefined;
  }

  private userHeaders(accessToken: string) {
    return {
      apikey: this.options.supabaseAnonKey,
      authorization: `Bearer ${accessToken}`,
    };
  }

  private serviceHeaders() {
    const key = this.options.serviceRoleKey as string;
    return {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    };
  }

  private async rpc(
    name: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) {
    const response = await this.fetcher(
      new URL(`/rest/v1/rpc/${name}`, this.baseUrl),
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      throw new Error(
        `Supabase billing RPC ${name} failed with HTTP ${response.status}.`,
      );
    return response;
  }
}

function mapCustomer(
  row: z.infer<typeof customerSchema>,
  expectedUserId: string,
): Entitlement {
  if (row.user_id !== expectedUserId)
    throw new Error("Supabase returned a billing customer for another user.");
  return {
    status: row.entitlement_status as EntitlementStatus,
    trialStartedAt: row.trial_started_at
      ? new Date(row.trial_started_at)
      : null,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
    processedWebhookIds: [],
    lastWebhookCreatedAt: row.last_webhook_created_at
      ? new Date(row.last_webhook_created_at)
      : null,
    lastWebhookId: row.last_webhook_id ?? null,
  };
}
