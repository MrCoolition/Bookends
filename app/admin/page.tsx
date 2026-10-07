import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Building2, Check, ClipboardList, Flag, Layers3, LockKeyhole, Settings2, ShieldCheck, Tags, UsersRound } from "lucide-react";
import { getAuthConfigurationStatus } from "@/lib/auth/config";
import { readIdentity } from "@/lib/auth/identity";
import { databaseConfigured, withMember } from "@/lib/operations/db";
import { OperationsError } from "@/lib/operations/service";
import { loadAdmin } from "@/lib/admin/service";
import { AdminWorkspace } from "@/components/admin-workspace";
import { LocalAdminWorkspace } from "@/components/local-admin-workspace";
import { localAdministrationEnabled } from "@/lib/admin/mode";
import { signIn, signOut, CORPORATE_PROVIDER_ID } from "@/auth";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { name: "Clients", Icon: Building2, description: "Client names, contacts, and the context that makes every relationship easier to manage.", detail: "Names · contacts · notes" },
  { name: "HOMEs", Icon: Layers3, description: "The practices your people belong to, with stable codes and names that can evolve.", detail: "Practices · descriptions" },
  { name: "People", Icon: UsersRound, description: "Teammate records, their HOME, and the named person accountable for their next chapter.", detail: "People · ownership · HOME" },
  { name: "Engagements", Icon: Flag, description: "Connect SOWs to months of delivery, with role headcount, allocation, skills, and phased team needs.", detail: "SOWs · dates · team demand" },
  { name: "Roles & skills", Icon: Tags, description: "Maintain a shared vocabulary for teammate profiles and the capabilities your engagements need.", detail: "Delivery roles · skills · matching" },
  { name: "Playbooks", Icon: ClipboardList, description: "Edit welcome and farewell steps, review new versions, and approve them for future journeys.", detail: "Steps · versions · approvals" },
  { name: "Access & settings", Icon: Settings2, description: "Your workspace name, verified member identities, and the roles and scopes they need.", detail: "Members · permissions · settings" },
];

export default async function AdminPage() {
  if (localAdministrationEnabled()) return <LocalAdminWorkspace />;
  const authConfigured = getAuthConfigurationStatus().configured;
  const dbConfigured = databaseConfigured();
  const configured = authConfigured && dbConfigured;
  let identity: Awaited<ReturnType<typeof readIdentity>> = null;
  let message = "";
  if (authConfigured) {
    try { identity = await readIdentity(); }
    catch { message = "Company sign-in is temporarily unavailable. Please try again shortly."; }
  }
  if (identity && dbConfigured) {
    try { return <AdminWorkspace initialData={await withMember(loadAdmin)} />; }
    catch (error) { message = error instanceof OperationsError ? error.message : "Administration is temporarily unavailable. Please try again shortly."; }
  }
  const title = !configured ? "Connect your administrative workspace." : identity ? "We couldn’t open administration yet." : "Sign in to manage your workspace.";
  const explanation = !configured
    ? `${!authConfigured && !dbConfigured ? "Company sign-in and the operational database still need to be configured." : !authConfigured ? "Company sign-in still needs to be configured." : "The operational database still needs to be configured."} An authorized administrator can open these sections once setup is complete. No operational records can be entered yet.`
    : message || "Use your approved company account. Administration opens after your identity and administrator permissions are verified.";
  return <div className="admin-workspace admin-access-page admin-access-gateway">
    <header className="admin-topbar"><Link href="/" className="admin-brand" aria-label="BOOKENDS home"><span aria-hidden="true">[<i />]</span> BOOKENDS</Link><span className="admin-top-label">WORKSPACE ADMIN</span><div><Link href="/" className="admin-back"><ArrowLeft size={15} /> Back to app</Link></div></header>
    <main className="admin-access-main">
      <div className="admin-access-heading"><div><p className="admin-eyebrow">THE DETAILS, IN ONE PLACE</p><h1>Administration<span aria-hidden="true">.</span></h1><p>Clients, people, and the configuration that keeps your workspace moving.</p></div><span className="admin-access-badge"><ShieldCheck size={15} /> Administrator access</span></div>
      <section id="admin-access" className="admin-access-panel" aria-labelledby="admin-access-title">
        <div className="admin-access-message"><span className="admin-access-icon"><LockKeyhole size={22} /></span><div><h2 id="admin-access-title">{title}</h2><p>{explanation}</p>
          {authConfigured && !identity && <form action={async () => { "use server"; await signIn(CORPORATE_PROVIDER_ID, { redirectTo: "/admin" }); }}><button className="admin-button admin-primary">Sign in to Administration <ArrowUpRight size={16} /></button></form>}
          {identity && <div className="admin-access-account"><p>Signed in as <strong>{identity.name}</strong></p><form action={async () => { "use server"; await signOut({ redirectTo: "/admin" }); }}><button className="admin-text-button">Sign out and use another account</button></form></div>}
          {configured && !identity && message && <p className="admin-error" role="alert">{message}</p>}
        </div></div>
        <dl className="admin-access-checks"><div><dt>Company sign-in</dt><dd className={authConfigured ? "is-configured" : ""}>{authConfigured ? <Check size={13} /> : <span aria-hidden="true" />}{authConfigured ? "Configured" : "Setup needed"}</dd></div><div><dt>Operational database</dt><dd className={dbConfigured ? "is-configured" : ""}>{dbConfigured ? <Check size={13} /> : <span aria-hidden="true" />}{dbConfigured ? "Configuration present" : "Setup needed"}</dd></div><div><dt>Administrator permissions</dt><dd>{identity ? "Access not established" : "Checked after sign-in"}</dd></div></dl>
      </section>
      <section aria-labelledby="admin-sections-title" className="admin-access-sections"><div className="admin-access-section-heading"><h2 id="admin-sections-title">Your administration sections</h2><p>{configured ? "Available to authorized workspace administrators." : "These sections unlock when setup and administrator access are complete."}</p></div><div className="admin-access-grid">{SECTIONS.map(({ name, Icon, description, detail }, index) => <article key={name} className="admin-access-card"><div className="admin-access-card-top"><span><Icon size={21} strokeWidth={1.7} /></span><small>{String(index + 1).padStart(2, "0")}</small></div><h2>{name}</h2><p>{description}</p><span className="admin-access-card-detail">{detail}</span></article>)}</div></section>
      <footer className="admin-access-footer"><span><ShieldCheck size={15} /> Real records stay protected by your organization’s access controls.</span><Link href="/journeys">Open journeys <ArrowUpRight size={14} /></Link></footer>
    </main>
  </div>;
}
