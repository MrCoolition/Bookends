import Link from "next/link";
import { ArrowUpRight, ShieldCheck, HeartHandshake } from "lucide-react";
import { getAuthConfigurationStatus } from "@/lib/auth/config";
import { readIdentity } from "@/lib/auth/identity";
import { databaseConfigured, withMember } from "@/lib/operations/db";
import { loadOperations, OperationsError } from "@/lib/operations/service";
import { ProductionWorkspace } from "@/components/production-workspace";
import { signIn, signOut, CORPORATE_PROVIDER_ID } from "@/auth";

export const dynamic = "force-dynamic";
export default async function JourneysPage() {
  const configured = getAuthConfigurationStatus().configured && databaseConfigured();
  const identity = configured ? await readIdentity() : null;
  let message = "";
  if (identity) {
    try { return <ProductionWorkspace initialData={await withMember(loadOperations)}/>; }
    catch (error) { message = error instanceof OperationsError ? error.message : "The workspace is temporarily unavailable. Please try again shortly."; }
  }
  return <main className="experience-gateway"><div className="experience-gateway-brand">[▪] BOOKENDS</div><section><span className="eyebrow">EVERY CHAPTER MATTERS</span><h1>A thoughtful welcome.<br/>A supported next step.</h1><p>One place for your preparation, people, and next chapter. Company journeys and mission transitions each get the care they deserve.</p><div className="experience-gateway-paths"><span>Company arrival</span><span>Mission launch</span><span>Mission handoff</span><span>Company farewell</span></div><div className="experience-gateway-access"><HeartHandshake size={28}/><div><h2>{!configured?"Your secure workspace is being connected.":identity?"Workspace access":"Welcome back."}</h2><p>{!configured?"Sign-in and the operational database must be configured before real teammate records can be entered. The design preview remains available below.":message||"Use your approved organization identity. Access is granted by your workspace administrator."}</p>{configured&&!identity&&<form action={async()=>{"use server";await signIn(CORPORATE_PROVIDER_ID,{redirectTo:"/journeys"});}}><button className="button button-primary">Sign in securely <ArrowUpRight size={17}/></button></form>}{identity&&<><details><summary>Identity details for your administrator</summary><p>Issuer: {identity.issuer}</p><p>Subject: {identity.subject}</p><p>These identifiers let an administrator link your approved identity to the right teammate record.</p></details><form action={async()=>{"use server";await signOut({redirectTo:"/journeys"});}}><button className="button button-secondary">Sign out</button></form></>}</div></div><p className="experience-gateway-note"><ShieldCheck size={15}/> Operational records stay on the server. External access changes, employment decisions, and email delivery are separate actions.</p><Link href="/demo" className="experience-gateway-demo">Explore the fictional design preview <ArrowUpRight size={15}/></Link></section></main>;
}
