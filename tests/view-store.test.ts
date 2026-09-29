import test from "node:test";
import assert from "node:assert/strict";
import { ViewStore } from "../lib/view-store";

test("consultas sobreviven al cambio de sección y se aíslan por cuenta y sesión", () => {
  const session = new ViewStore();
  const dispatch = JSON.stringify(["account-a", "dispatch:result"]);
  const other = JSON.stringify(["account-b", "dispatch:result"]);
  const result = { orders: [{ id: "123" }], date: "2026-09-01" };
  let renders = 0;
  const unsubscribe = session.subscribe(() => { renders++; });
  session.write(dispatch, result);
  assert.equal(renders, 1);
  unsubscribe(); // navigating away unmounts the section
  session.write("profits:filter", "pending");
  assert.equal(renders, 1);
  assert.equal(session.read(dispatch, undefined), result);
  assert.equal(session.read(other, undefined), undefined);
  assert.equal(new ViewStore().read(dispatch, undefined), undefined, "a new login gets an empty store");
  session.write(dispatch, undefined);
  assert.equal(session.read(dispatch, result), undefined, "explicitly cleared queries don't reappear");
});
