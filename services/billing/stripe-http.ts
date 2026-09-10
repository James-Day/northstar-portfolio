/** Edge-compatible Stripe webhook verification and HTTP boundary contracts.
 *
 * The verifier intentionally receives the untouched request body. Parsing the
 * body before checking the signature can change whitespace and invalidate a
 * legitimate Stripe signature.
 */

export type VerifiedStripeEvent = {
  id: string;
  type: string;
  created: number;
  data: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export class StripeSignatureError extends Error {
  constructor(message = "Stripe webhook signature is invalid.") {
    super(message);
    this.name = "StripeSignatureError";
  }
}

export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string | undefined,
  options: { now?: Date; toleranceSeconds?: number } = {},
): Promise<VerifiedStripeEvent> {
  if (!webhookSecret)
    throw new StripeSignatureError("Stripe webhook secret is not configured.");
  const parsed = parseSignatureHeader(signatureHeader);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  if (
    !Number.isInteger(parsed.timestamp) ||
    Math.abs(nowSeconds - parsed.timestamp) > tolerance
  ) {
    throw new StripeSignatureError(
      "Stripe webhook timestamp is outside the allowed tolerance.",
    );
  }

  const expected = await hmacHex(
    webhookSecret,
    `${parsed.timestamp}.${rawBody}`,
  );
  if (
    !parsed.signatures.some((candidate) => secureHexEqual(candidate, expected))
  ) {
    throw new StripeSignatureError();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawBody);
  } catch {
    throw new StripeSignatureError("Stripe webhook body is not valid JSON.");
  }
  if (
    !isRecord(raw) ||
    typeof raw.id !== "string" ||
    !raw.id ||
    typeof raw.type !== "string" ||
    !raw.type ||
    typeof raw.created !== "number" ||
    !Number.isInteger(raw.created) ||
    !isRecord(raw.data)
  ) {
    throw new StripeSignatureError(
      "Stripe webhook body has an invalid event shape.",
    );
  }
  return {
    id: raw.id,
    type: raw.type,
    created: raw.created,
    data: raw.data,
    raw,
  };
}

export type StripeCheckoutInput = {
  userId: string;
  accessToken: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
};

export type BillingPortalInput = {
  userId: string;
  accessToken: string;
  returnUrl: string;
};

export type StripeBillingHttpDependencies = {
  createCheckoutSession(input: StripeCheckoutInput): Promise<{ url: string }>;
  createBillingPortalSession(
    input: BillingPortalInput,
  ): Promise<{ url: string }>;
  handleVerifiedWebhook(event: VerifiedStripeEvent): Promise<void>;
};

export type StripeApiOptions = {
  secretKey: string;
  resolveCustomerId?: (
    userId: string,
    accessToken: string,
  ) => Promise<string | undefined>;
  fetcher?: typeof fetch;
};

/**
 * Small fetch-only Stripe adapter for Workers. Form encoding keeps the
 * integration edge-compatible and avoids shipping the Node Stripe SDK.
 */
export function createStripeApi(
  options: StripeApiOptions,
): StripeBillingHttpDependencies {
  const secretKey = options.secretKey.trim();
  if (!secretKey)
    throw new BillingConfigurationError("STRIPE_SECRET_KEY is not configured.");
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const request = async (
    path: string,
    params: URLSearchParams,
  ): Promise<Record<string, unknown>> => {
    const response = await fetcher(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !isRecord(payload)) {
      const message =
        isRecord(payload) &&
        isRecord(payload.error) &&
        typeof payload.error.message === "string"
          ? payload.error.message
          : `Stripe API request failed with HTTP ${response.status}.`;
      throw new Error(message);
    }
    return payload;
  };
  return {
    async createCheckoutSession(input) {
      const params = new URLSearchParams();
      params.set("mode", "subscription");
      params.set("line_items[0][price]", input.priceId);
      params.set("line_items[0][quantity]", "1");
      params.set("success_url", input.successUrl);
      params.set("cancel_url", input.cancelUrl);
      params.set("client_reference_id", input.userId);
      params.set("metadata[user_id]", input.userId);
      params.set("subscription_data[metadata][user_id]", input.userId);
      const payload = await request("checkout/sessions", params);
      if (typeof payload.url !== "string" || !payload.url)
        throw new Error("Stripe did not return a Checkout URL.");
      return { url: payload.url };
    },
    async createBillingPortalSession(input) {
      if (!options.resolveCustomerId)
        throw new BillingConfigurationError(
          "Stripe customer lookup is not configured.",
        );
      const customer = await options.resolveCustomerId(
        input.userId,
        input.accessToken,
      );
      if (!customer)
        throw new BillingConfigurationError(
          "No Stripe customer exists for this account.",
        );
      const params = new URLSearchParams({
        customer,
        return_url: input.returnUrl,
      });
      const payload = await request("billing_portal/sessions", params);
      if (typeof payload.url !== "string" || !payload.url)
        throw new Error("Stripe did not return a Billing Portal URL.");
      return { url: payload.url };
    },
    async handleVerifiedWebhook() {
      throw new Error(
        "Stripe webhook handling must be composed with the durable webhook reducer.",
      );
    },
  };
}

export type BillingPlan = "monthly" | "annual";

export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigurationError";
  }
}

/**
 * Resolve a server-configured price. Clients send a plan name so they cannot
 * choose an arbitrary Stripe price or alter the amount charged.
 */
export function resolveBillingPriceId(
  plan: BillingPlan,
  prices: { monthly?: string; annual?: string },
): string {
  const priceId = prices[plan]?.trim();
  if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new BillingConfigurationError(
      `Stripe ${plan} price is not configured.`,
    );
  }
  return priceId;
}

/** Build a same-origin return URL from a trusted server origin and fixed path. */
export function buildBillingReturnUrl(
  appOrigin: string | undefined,
  path: "/dashboard?billing=success" | "/dashboard?billing=cancelled",
): string {
  const value = appOrigin?.trim() || "http://localhost:3000";
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new BillingConfigurationError(
      "APP_ORIGIN must be an absolute HTTP(S) URL.",
    );
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  ) {
    throw new BillingConfigurationError(
      "APP_ORIGIN must be a clean HTTP(S) origin.",
    );
  }
  return new URL(path, origin).toString();
}

/** Stripe should only return a navigable HTTPS URL to the browser. */
export function validateStripeSessionUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BillingConfigurationError(
      "Stripe returned an invalid session URL.",
    );
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new BillingConfigurationError(
      "Stripe returned an unsafe session URL.",
    );
  }
  return url.toString();
}

function parseSignatureHeader(value: string | null | undefined): {
  timestamp: number;
  signatures: string[];
} {
  if (!value)
    throw new StripeSignatureError("Stripe signature header is missing.");
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of value.split(",")) {
    const [key, rawValue] = part.split("=", 2);
    if (key === "t" && rawValue) timestamp = Number(rawValue);
    if (key === "v1" && rawValue && /^[0-9a-f]+$/i.test(rawValue))
      signatures.push(rawValue);
  }
  if (timestamp === undefined || signatures.length === 0)
    throw new StripeSignatureError("Stripe signature header is malformed.");
  return { timestamp, signatures };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function secureHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
