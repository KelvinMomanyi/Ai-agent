import { generateKeyPairSync } from "node:crypto";
// jsonwebtoken is CommonJS; Node exposes module.exports as the default.
// eslint-disable-next-line import/default
import jwt from "jsonwebtoken";
import { HttpResponseError } from "@shopify/shopify-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./offline-token-migration.server", () => ({
  getTokenApi: () => ({
    clients: {
      Graphql: class {
        request = sdk.request;
      },
    },
  }),
}));
import {
  createClientAssertion,
  getApplicationOnlyAdminContext,
  getApplicationOnlyToken,
} from "./application-only-token.server";

// eslint-disable-next-line import/no-named-as-default-member
const { verify, decode } = jwt;

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
let caseNumber = 0;
let shop: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  shop = `token-test-${++caseNumber}.myshopify.com`;
  vi.stubEnv("SHOPIFY_API_KEY", "test-client-id");
  vi.stubEnv("SHOPIFY_KEY_ID", "test-key-id");
  vi.stubEnv(
    "SHOPIFY_PRIVATE_KEY",
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sdk.request.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function tokenResponse(accessToken = "app-only-token", seconds = 3599) {
  return Response.json({
    access_token: accessToken,
    scope: "read_products",
    expires_in: seconds,
  });
}

describe("application-only access", () => {
  it("signs store-specific assertions with a unique jti and 60-second lifetime", () => {
    const first = createClientAssertion(shop);
    const claims = verify(first, keys.publicKey, {
      algorithms: ["RS256"],
      audience: `https://${shop}/admin/oauth/access_token`,
      issuer: "test-client-id",
      subject: "test-client-id",
    }) as jwt.JwtPayload;
    const header = decode(first, { complete: true })?.header;
    expect(header?.kid).toBe("test-key-id");
    expect(claims.exp! - claims.iat!).toBe(60);
    expect(
      (decode(createClientAssertion(shop)) as jwt.JwtPayload).jti,
    ).not.toBe(claims.jti);
  });

  it("supports P-256 EC keys", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    vi.stubEnv(
      "SHOPIFY_PRIVATE_KEY",
      ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    expect(() =>
      verify(createClientAssertion(shop), ec.publicKey, {
        algorithms: ["ES256"],
      }),
    ).not.toThrow();
  });

  it.each([
    "example.com",
    "store.myshopify.com/path",
    "STORE.myshopify.com",
    "store.myshopify.com:443",
  ])("rejects an unsafe token endpoint: %s", (domain) => {
    expect(() => createClientAssertion(domain)).toThrow("permanent lowercase");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("coalesces requests, reads expires_in and sends no client secret", async () => {
    fetchMock.mockResolvedValue(tokenResponse("application-token", 1200));
    const before = Date.now();
    const [first, second] = await Promise.all([
      getApplicationOnlyToken(shop),
      getApplicationOnlyToken(shop),
    ]);
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.expires.getTime()).toBeGreaterThanOrEqual(before + 1_200_000);
    const options = fetchMock.mock.calls[0][1];
    expect(options.redirect).toBe("error");
    expect(options.body.get("grant_type")).toBe("client_credentials");
    expect(options.body.has("client_secret")).toBe(false);
    expect(options.body.has("scope")).toBe(false);
    expect(await getApplicationOnlyToken(shop)).toBe(first);
  });

  it("retries transient failures with a newly signed assertion", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(tokenResponse());
    const request = getApplicationOnlyToken(shop);
    await vi.runAllTimersAsync();
    await request;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const assertions = fetchMock.mock.calls.map(([, options]) =>
      options.body.get("client_assertion"),
    );
    expect(assertions[0]).not.toBe(assertions[1]);
  });

  it("does not retry permanent failures or expose response secrets", async () => {
    fetchMock.mockResolvedValue(
      new Response("sensitive-response", { status: 401 }),
    );
    await expect(getApplicationOnlyToken(shop)).rejects.toThrow(
      "returned HTTP 401",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects token responses without usable expiry metadata", async () => {
    fetchMock.mockResolvedValue(tokenResponse("token", 0));
    await expect(getApplicationOnlyToken(shop)).rejects.toThrow("incomplete");
  });

  it("renews cached tokens before expiry", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(tokenResponse("first", 600))
      .mockResolvedValueOnce(tokenResponse("second"));
    expect((await getApplicationOnlyToken(shop)).accessToken).toBe("first");
    await vi.advanceTimersByTimeAsync(600_000);
    expect((await getApplicationOnlyToken(shop)).accessToken).toBe("second");
  });

  it("recovers a rejected GraphQL token once without overwriting an offline pair", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse("first"))
      .mockResolvedValueOnce(tokenResponse("second"));
    sdk.request
      .mockRejectedValueOnce(
        new HttpResponseError({
          message: "Unauthorized",
          code: 401,
          statusText: "Unauthorized",
        }),
      )
      .mockResolvedValueOnce({ data: { shop: { name: "Store" } } });
    const context = await getApplicationOnlyAdminContext(shop);
    expect(context.session.id).toBe(`application_only_${shop}`);
    expect(context.session.refreshToken).toBeUndefined();
    const response = await context.admin.graphql("query { shop { name } }");
    expect(await response.json()).toEqual({
      data: { shop: { name: "Store" } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after a second GraphQL authentication rejection", async () => {
    fetchMock.mockImplementation(async () => tokenResponse());
    sdk.request.mockRejectedValue(
      new HttpResponseError({
        message: "Unauthorized",
        code: 401,
        statusText: "Unauthorized",
      }),
    );
    const context = await getApplicationOnlyAdminContext(shop);
    await expect(
      context.admin.graphql("query { shop { name } }"),
    ).rejects.toThrow("Unauthorized");
    expect(sdk.request).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
