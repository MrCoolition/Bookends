import { LocalAdminError, MAX_LOCAL_ADMIN_CLIENTS, parseLocalAdminStore, type LocalAdminStore } from "./local";

/** Company-provided starting clients for the deployed open setup. No contacts are inferred. */
export const STARTING_CLIENTS = [
  { id: "31c916e0-4936-4dd9-889a-538e5367b201", code: "BIG4", name: "Big 4" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b202", code: "TQL", name: "TQL" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b203", code: "NISOURCE", name: "Nisource" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b204", code: "COMPASS", name: "Compass" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b205", code: "VANTIVE", name: "Vantive" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b206", code: "OTHERS", name: "Others" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b207", code: "CHIPOTLE", name: "Chipotle" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b208", code: "SAFELITE", name: "Safelite" },
  { id: "31c916e0-4936-4dd9-889a-538e5367b209", code: "FIRSTBANKOHIO", name: "First Bank of Ohio" },
] as const;

const key = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Add missing starting clients once; never relabel, reactivate, or replace saved records. */
export function seedLocalAdminClients(input: LocalAdminStore): LocalAdminStore {
  const store = parseLocalAdminStore(input);
  if (store.clientSeedVersion === 1) return store;
  for (const seed of STARTING_CLIENTS) {
    const exists = store.data.clients.some(client => client.id === seed.id || key(client.code) === key(seed.code) || key(client.name) === key(seed.name));
    if (!exists) store.data.clients.push({ ...seed, contactName: "", contactEmail: "", notes: "", active: true, revision: 1 });
  }
  if (store.data.clients.length > MAX_LOCAL_ADMIN_CLIENTS) throw new LocalAdminError("client_seed_limit", "The starting clients exceed the browser setup's client limit.");
  store.clientSeedVersion = 1;
  store.revision++;
  store.data.asOf = new Date().toISOString();
  return parseLocalAdminStore(store);
}
