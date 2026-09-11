import { describe, expect, it, vi } from "vitest";
import { createStripeApi, createStripeCustomerCancellation } from "./stripe-http";

describe("Stripe API adapter", () => {
  it("creates a subscription Checkout session with server-owned metadata", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" }),
          { status: 200 },
        ),
    );
    const billing = createStripeApi({ secretKey: "sk_test_123", fetcher });
    await expect(
      billing.createCheckoutSession({
        userId: "user-1",
        accessToken: "token",
        priceId: "price_monthly",
        successUrl: "https://app.test/success",
        cancelUrl: "https://app.test/cancel",
      }),
    ).resolves.toEqual({ url: "https://checkout.stripe.com/c/pay/test" });
    const request = (
      fetcher.mock.calls as unknown as Array<
        [RequestInfo, RequestInit | undefined]
      >
    )[0][1] as RequestInit;
    expect(request.headers).toMatchObject({
      authorization: "Bearer sk_test_123",
    });
    const body = new URLSearchParams(String(request.body));
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("line_items[0][price]")).toBe("price_monthly");
    expect(body.get("client_reference_id")).toBe("user-1");
    expect(body.get("subscription_data[metadata][user_id]")).toBe("user-1");
  });

  it("looks up the mapped customer before creating a Billing Portal session", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ url: "https://billing.stripe.com/p/session" }),
          { status: 200 },
        ),
    );
    const lookup = vi.fn(async () => "cus_123");
    const billing = createStripeApi({
      secretKey: "sk_test_123",
      fetcher,
      resolveCustomerId: lookup,
    });
    await expect(
      billing.createBillingPortalSession({
        userId: "user-1",
        accessToken: "token",
        returnUrl: "https://app.test/settings",
      }),
    ).resolves.toEqual({ url: "https://billing.stripe.com/p/session" });
    expect(lookup).toHaveBeenCalledWith("user-1", "token");
    const body = new URLSearchParams(
      String(
        (
          (
            fetcher.mock.calls as unknown as Array<
              [RequestInfo, RequestInit | undefined]
            >
          )[0][1] as RequestInit
        ).body,
      ),
    );
    expect(body.get("customer")).toBe("cus_123");
  });

  it("reuses only the server-resolved customer on a later Checkout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/test" }), { status: 200 }));
    const lookup = vi.fn(async () => "cus_123");
    const billing = createStripeApi({ secretKey: "sk_test_123", fetcher, resolveCustomerId: lookup });
    await billing.createCheckoutSession({ userId: "user-1", accessToken: "token", priceId: "price_annual", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" });
    const body = new URLSearchParams(String((fetcher.mock.calls[0][1] as RequestInit).body));
    expect(lookup).toHaveBeenCalledWith("user-1", "token");
    expect(body.get("customer")).toBe("cus_123");
  });

  it("cancels billable subscriptions across pages and skips already-canceled records", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "sub_active", status: "active" }, { id: "sub_done", status: "canceled" }], has_more: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sub_active", status: "canceled" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "sub_trial", status: "trialing" }], has_more: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sub_trial", status: "canceled" }), { status: 200 }));
    const cancel = createStripeCustomerCancellation({ secretKey: "sk_test_123", fetcher });
    await cancel("cus_123");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(String(fetcher.mock.calls[0][0])).toContain("customer=cus_123");
    expect(String(fetcher.mock.calls[2][0])).toContain("starting_after=sub_done");
    expect((fetcher.mock.calls[1][1] as RequestInit).method).toBe("DELETE");
  });
});
