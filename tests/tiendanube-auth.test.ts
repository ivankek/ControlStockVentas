import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { nubeAuthorizationUrl, validNubeState, validNubeSignature, exchangeNubeCode } from "../lib/tiendanube-auth";
import { POST as privacy } from "../app/api/tiendanube/privacy/[topic]/route";

test("OAuth apunta a Tiendanube y conserva el state sin aceptar un ID arbitrario", () => {
  const url = new URL(nubeAuthorizationUrl("47685", "a+b/c"));
  assert.equal(url.origin, "https://www.tiendanube.com");
  assert.equal(url.pathname, "/apps/47685/authorize");
  assert.equal(url.searchParams.get("state"), "a+b/c");
  assert.throws(() => nubeAuthorizationUrl("../other", "state"));
});
test("OAuth rechaza state ausente, distinto o vencido", () => {
  const data = { state: "nonce", expires: 101 };
  assert.equal(validNubeState(data, "nonce", 100), true);
  assert.equal(validNubeState(data, "nonce", 101), false);
  assert.equal(validNubeState(data, "other", 100), false);
  assert.equal(validNubeState(data, null, 100), false);
});
test("HMAC rechaza cuerpo alterado, firma ausente y secreto incorrecto", () => {
  const body = '{"store_id":123}';
  const signature = createHmac("sha256", "secret").update(body).digest("hex");
  assert.equal(validNubeSignature(body, signature, "secret"), true);
  assert.equal(validNubeSignature(body + " ", signature, "secret"), false);
  assert.equal(validNubeSignature(body, signature, "other"), false);
  assert.equal(validNubeSignature(body, null, "secret"), false);
  assert.equal(validNubeSignature(body, "aa", "secret"), false);
});
test("Privacidad exige firma y entrega un informe vacío sin eco de datos personales", async () => {
  const old = process.env.TIENDANUBE_CLIENT_SECRET;
  process.env.TIENDANUBE_CLIENT_SECRET = "test-secret";
  try {
    const body = JSON.stringify({ store_id: 123, event: "customers/data_request", customer: { email: "private@example.test" } });
    const context = { params: Promise.resolve({ topic: "customers-data-request" }) };
    assert.equal((await privacy(new Request("https://example.test", { method: "POST", body }), context)).status, 401);
    const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
    const response = await privacy(new Request("https://example.test", { method: "POST", body, headers: { "x-linkedstore-hmac-sha256": signature } }), context);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.customer_data, []);
    assert.equal(JSON.stringify(result).includes("private@example.test"), false);
  } finally { if (old === undefined) delete process.env.TIENDANUBE_CLIENT_SECRET; else process.env.TIENDANUBE_CLIENT_SECRET = old; }
});
test("Intercambio obtiene el store ID del user_id y oculta errores del proveedor", async (t) => {
  const oldId = process.env.TIENDANUBE_CLIENT_ID, oldSecret = process.env.TIENDANUBE_CLIENT_SECRET;
  process.env.TIENDANUBE_CLIENT_ID = "47685"; process.env.TIENDANUBE_CLIENT_SECRET = "test-secret";
  try {
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      assert.equal(url, "https://www.tiendanube.com/apps/authorize/token");
      assert.equal(JSON.parse(String(init.body)).grant_type, "authorization_code");
      return Response.json({ user_id: 123, access_token: "fake-token-for-test" });
    });
    assert.equal((await exchangeNubeCode("code")).user_id, "123");
    t.mock.restoreAll();
    t.mock.method(globalThis, "fetch", async () => new Response("sensitive-provider-error", { status: 400 }));
    await assert.rejects(exchangeNubeCode("code"), { message: "Tiendanube no pudo completar la autorización." });
  } finally {
    if (oldId === undefined) delete process.env.TIENDANUBE_CLIENT_ID; else process.env.TIENDANUBE_CLIENT_ID = oldId;
    if (oldSecret === undefined) delete process.env.TIENDANUBE_CLIENT_SECRET; else process.env.TIENDANUBE_CLIENT_SECRET = oldSecret;
  }
});
