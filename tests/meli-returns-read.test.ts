import test from "node:test";
import assert from "node:assert/strict";
import { readReturnResource } from "../lib/meli-returns-read";

test("403 conserva recurso y código sin filtrar cuerpo privado ni token", async () => {
  const original = global.fetch;
  global.fetch = async () => Response.json({ code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES", message: "private-user-data", status: 403 }, { status: 403 });
  try {
    await assert.rejects(readReturnResource("/post-purchase/v1/claims/search?players.user_id=123", "secret-token"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { status: number }).status, 403);
      assert.match(error.message, /búsqueda de reclamos/);
      assert.match(error.message, /PA_UNAUTHORIZED_RESULT_FROM_POLICIES/);
      assert.doesNotMatch(error.message, /private-user-data|secret-token/);
      return true;
    });
  } finally { global.fetch = original; }
});
