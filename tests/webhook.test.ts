import test from "node:test";
import assert from "node:assert/strict";
import { receiveNotification } from "../lib/meli-notification-handler";
import { MAX_NOTIFICATION_BYTES } from "../lib/meli-webhook";

test("webhook: persiste órdenes antes del ACK sin confiar en datos del aviso ni filtrar secretos", async (t) => {
  const queued: string[][] = [];
  let schedules = 0, unavailable = false;
  const POST = (request: Request) => receiveNotification(request, {
    enqueue: async (...args) => { if (unavailable) throw Error("SECRET_DATABASE_ERROR"); queued.push(args); return true; },
    schedule: () => { assert.ok(queued.length); schedules++; },
  });
  const oldId = process.env.MELI_CLIENT_ID;
  process.env.MELI_CLIENT_ID = "123456";
  t.after(() => {
    if (oldId === undefined) delete process.env.MELI_CLIENT_ID;
    else process.env.MELI_CLIENT_ID = oldId;
  });
  const logs: string[] = [];
  t.mock.method(console, "info", (line: string) => logs.push(line));
  t.mock.method(console, "warn", (line: string) => logs.push(line));
  t.mock.method(globalThis, "fetch", () => { throw Error("No network allowed"); });
  const envelope = {
    topic: "orders_v2", resource: "/orders/987", user_id: 987,
    application_id: 123456,
  };
  const send = (payload: unknown) => POST(new Request("http://localhost/api/meli/webhooks", {
    method: "POST", body: JSON.stringify(payload),
  }));

  await t.test("topics conocidos, desconocidos, metadata cambiante e IDs como texto", async () => {
    for (const topic of ["orders_v2", "items", "shipments", "stock-location", "stock_locations", "user_products", "user_products_families", "future_topic"]) {
      const result = await send({
        ...envelope, topic, application_id: "123456", user_id: "987",
        id: "SECRET_ID", actions: { future: true }, attempts: "changed",
        access_token: "SECRET_TOKEN", resource: "opaque-SECRET_RESOURCE",
      });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { received: true });
    }
    assert.equal(JSON.parse(logs.at(-1)!).topic, "unknown");
  });
  await t.test("repetidos e identificadores opcionales", async () => {
    for (const extra of [{}, { _id: "repeated" }, { _id: "repeated" }])
      assert.equal((await send({ ...envelope, ...extra })).status, 200);
    assert.equal(schedules, 3);
    assert.deepEqual(queued, [["987", "987"], ["987", "987"], ["987", "987"]]);
  });
  await t.test("sin persistencia no confirma; recursos ajenos no se consultan", async () => {
    unavailable = true;
    assert.equal((await send(envelope)).status, 503);
    for (const resource of ["https://attacker/orders/987", "/orders/987/../../users", "/orders/0"]) {
      assert.equal((await send({ ...envelope, resource })).status, 200);
    }
    assert.equal(schedules, 3);
    unavailable = false;
  });
  await t.test("rechaza JSON inválido y estructura incompleta", async () => {
    for (const payload of [null, [], "text", {}, { ...envelope, topic: "" }, { ...envelope, user_id: -1 }, { ...envelope, application_id: Number.MAX_SAFE_INTEGER + 1 }])
      assert.equal((await send(payload)).status, 400);
    assert.equal((await POST(new Request("http://localhost", { method: "POST", body: "{SECRET" }))).status, 400);
  });
  await t.test("rechaza otra aplicación y configuración ausente", async () => {
    assert.equal((await send({ ...envelope, application_id: 456 })).status, 403);
    delete process.env.MELI_CLIENT_ID;
    assert.equal((await send(envelope)).status, 503);
    process.env.MELI_CLIENT_ID = "123456";
  });
  await t.test("limita bytes reales aun con content-length falso y múltiples chunks", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_NOTIFICATION_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const request = new Request("http://localhost", {
      method: "POST", body, headers: { "content-length": "1" }, duplex: "half",
    } as RequestInit);
    assert.equal((await POST(request)).status, 413);
  });
  await t.test("logs nunca incluyen contenido arbitrario ni errores del parser", async () => {
    assert.equal((await send({ ...envelope, topic: "SECRET_TOPIC\nforged" })).status, 200);
    assert.ok(!logs.join("\n").includes("SECRET"));
    for (const line of logs) {
      const log = JSON.parse(line);
      assert.ok(["meli_webhook_received", "meli_webhook_rejected"].includes(log.event));
      assert.ok(Object.keys(log).every((key) => ["event", "topic", "disposition", "reason"].includes(key)));
    }
  });
});
