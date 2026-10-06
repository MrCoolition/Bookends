import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { readIdentity } from "@/lib/auth/identity";
import { withMember } from "@/lib/operations/db";
import { OperationsError } from "@/lib/operations/service";
import { loadAdmin } from "@/lib/admin/service";
import { AdminWorkspace } from "@/components/admin-workspace";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!await readIdentity()) redirect("/journeys");
  try { return <AdminWorkspace initialData={await withMember(loadAdmin)} />; }
  catch (error) {
    const message = error instanceof OperationsError ? error.message : "Administration is temporarily unavailable. Please try again shortly.";
    return <main className="experience-gateway">
      <div className="experience-gateway-brand">[▪] BOOKENDS</div>
      <section>
        <span className="eyebrow">WORKSPACE ADMINISTRATION</span>
        <h1>The right access.<br />The right people.</h1>
        <div className="experience-gateway-access"><ShieldCheck size={28} /><div><h2>Workspace access</h2><p>{message}</p></div></div>
        <Link href="/journeys" className="experience-gateway-demo"><ArrowLeft size={16} /> Return to your journeys</Link>
      </section>
    </main>;
  }
}
