export const accountId = "00000000-0000-4000-8000-000000000042";
export const profileFixture = { id: "owner", role: "USER", display_name: "Test" };
export const accountFixture = { id: accountId, owner_id: "owner", seller_id: "42", nickname: "Test", catalog_version: 0 };
export const snapshotFixture = { profile: profileFixture, accounts: [accountFixture], people: [profileFixture], relationships: [], variants: [], mappings: [], movements: [], legacy: [] };
export function inventoryReadMock(url: URL, encrypted: string, version = 0): Response | undefined {
  if (url.pathname === "/rest/v1/app_profiles") return Response.json(profileFixture);
  if (url.pathname === "/rest/v1/meli_accounts") return Response.json(url.searchParams.get("select") === "encrypted_tokens" ? { encrypted_tokens: encrypted } : [{ ...accountFixture, catalog_version: version }]);
  if (url.pathname === "/rest/v1/rpc/inventory_snapshot") return Response.json(snapshotFixture);
}
