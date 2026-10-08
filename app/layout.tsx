import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";
import "./planner.css";
import "./experience.css";
import "./admin.css";
import "./engagements.css";
import "./shared-workspace.css";
import "./team-studio.css";
import "./sow-intake.css";
import "./capability-controls.css";
import "./capability-admin.css";
export const metadata: Metadata = {
  title: "BOOKENDS — Every ending. A new beginning.",
  description: "Your people. Their next mission. One extraordinary view. Explore the BOOKENDS resource alignment workspace.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
