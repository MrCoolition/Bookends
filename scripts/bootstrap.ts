import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrationClient, reportSetupFailure, SetupError } from "./migrate";
import type { JourneyActor, JourneyRole, PermissionScope } from "../lib/journeys/types";

const ROLES: JourneyRole[] = ["resource", "placement_owner", "home_leader", "mission_owner", "client_liaison", "asset_access_owner", "administrator"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArguments(args: string[]) {
  const values = new Map<string, string>();
  const allowed = new Set(["--organization-name", "--organization-id", "--issuer", "--subject", "--name", "--roles", "--resource-id", "--home-scope", "--actor-id"]);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--production") continue;
    if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith("--")) throw new SetupError("Bootstrap arguments are missing, duplicated, or unsupported. Supply explicit organization, issuer, subject, and name options.");
    values.set(args[i], args[++i]);
  }
  return values;
}

export async function bootstrap() {
  const args = process.argv.slice(2);
  const options = parseArguments(args);
  const { client, environment } = migrationClient(args);
  const organizationName = options.get("--organization-name")?.trim();
  const existingOrganization = options.get("--organization-id");
  if (!!organizationName === !!existingOrganization) throw new SetupError("Supply either --organization-name for a first organization or --organization-id for an existing organization.");
  if (organizationName && organizationName.length > 200) throw new SetupError("Organization names must be 200 characters or fewer.");
  if (existingOrganization && !UUID.test(existingOrganization)) throw new SetupError("--organization-id must be a UUID.");
  const organizationId = existingOrganization ?? randomUUID();
  const resourceId = options.get("--resource-id") ?? null;
  const actorId = options.get("--actor-id");
  if (resourceId && !UUID.test(resourceId)) throw new SetupError("--resource-id must be a UUID.");
  if (existingOrganization && (!actorId || !UUID.test(actorId))) throw new SetupError("Adding a teammate requires --actor-id for an active administrator in the existing organization.");
  const issuer = options.get("--issuer");
  let issuerUrl: URL;
  try { issuerUrl = new URL(issuer ?? ""); } catch { throw new SetupError("--issuer must be the verified corporate HTTPS OIDC issuer."); }
  if (issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash || issuer !== issuer?.trim()) throw new SetupError("--issuer must be the verified corporate HTTPS OIDC issuer without credentials, query, or fragment.");
  if (process.env.AUTH_OIDC_ISSUER && issuer !== process.env.AUTH_OIDC_ISSUER) throw new SetupError("The supplied issuer must exactly match AUTH_OIDC_ISSUER.");
  const subject = options.get("--subject");
  const name = options.get("--name")?.trim();
  if (!subject || subject.length > 255 || /[\u0000-\u001f\u007f]/.test(subject)) throw new SetupError("--subject must be the provider-verified immutable subject, not an inferred email address.");
  if (!name || name.length > 160) throw new SetupError("--name is required and must be 160 characters or fewer.");
  if (existingOrganization && !options.has("--roles")) throw new SetupError("Explicit --roles are required when adding a teammate.");
  const roles = [...new Set((options.get("--roles") ?? "administrator").split(",").map(role => role.trim()))];
  if (!roles.length || roles.some(role => !ROLES.includes(role as JourneyRole))) throw new SetupError("--roles must contain only recognized BOOKENDS role names.");
  if (!existingOrganization && roles[0] !== "administrator") throw new SetupError("The first organization's initial role must be administrator; additional verifier roles must be explicit.");
  if (roles.includes("resource") && !resourceId) throw new SetupError("The resource role requires an explicit same-organization --resource-id.");
  const homeScope = options.get("--home-scope")?.trim() ?? null;
  if (roles.includes("home_leader") && !homeScope) throw new SetupError("The home_leader role requires --home-scope.");
  if (homeScope && (homeScope.length > 80 || /[\u0000-\u001f\u007f]/.test(homeScope))) throw new SetupError("--home-scope must be 80 characters or fewer without control characters.");
  if (!existingOrganization && homeScope) throw new SetupError("The first organization's administrator must be unscoped. Add home-scoped teammates after organization bootstrap.");
  const scopeFor = (role: string): PermissionScope => ({ organizationId, ...(role === "resource" ? { resourceId: resourceId! } : {}), ...(role === "home_leader" ? { homeId: homeScope! } : {}) });
  const grants: JourneyActor["grants"] = roles.slice(1).map(role => ({ role: role as JourneyRole, scope: scopeFor(role) }));
  const memberId = randomUUID();
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bookends:bootstrap'))");
    await client.query("SELECT set_config('bookends.organization_id',$1,true), set_config('bookends.issuer',$2,true), set_config('bookends.subject',$3,true)", [organizationId, issuer, subject]);
    const existing = await client.query("SELECT id FROM be_memberships WHERE issuer=$1 AND subject=$2", [issuer, subject]);
    if (existing.rowCount) throw new SetupError("This corporate identity already has a membership. Bootstrap never overwrites existing access grants.");
    if (existingOrganization) {
      const admin = await client.query<{ role: JourneyRole; home_scope: string | null }>("SELECT role, home_scope FROM be_memberships WHERE organization_id=$1 AND id=$2 AND active=true FOR UPDATE", [organizationId, actorId]);
      if (!admin.rowCount || admin.rows[0].role !== "administrator" || admin.rows[0].home_scope !== null) throw new SetupError("--actor-id must identify an active unscoped primary organization administrator.");
    } else await client.query("INSERT INTO be_organizations(id,name) VALUES ($1,$2)", [organizationId, organizationName]);
    if (resourceId) {
      const resource = await client.query("SELECT id FROM be_resources WHERE organization_id=$1 AND id=$2", [organizationId, resourceId]);
      if (!resource.rowCount) throw new SetupError("The linked resource must exist in this organization before membership provisioning.");
    }
    await client.query("INSERT INTO be_memberships(id,organization_id,issuer,subject,name,role,grants,resource_id,home_scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [memberId, organizationId, issuer, subject, name, roles[0], JSON.stringify(grants), resourceId, homeScope]);
    await client.query("INSERT INTO be_events(organization_id,id,actor_id,operation,payload) VALUES ($1,$2,$3,'membership.bootstrap',$4)", [organizationId, randomUUID(), existingOrganization ? actorId : memberId, JSON.stringify({ membershipId: memberId, roles, method: "explicit_database_administrator_cli" })]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ environment, organizationId, memberId, roles }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) bootstrap().catch(reportSetupFailure);
