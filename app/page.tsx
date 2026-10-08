import { Workspace } from "@/components/workspace";
import { redirect } from "next/navigation";
export default function Page() {
  if (process.env.BOOKENDS_MODE === "production") redirect("/journeys");
  if (process.env.BOOKENDS_ADMIN_MODE === "shared") redirect("/studio");
  return <Workspace />;
}
