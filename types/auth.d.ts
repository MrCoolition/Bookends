import "next-auth";
import "next-auth/jwt";
import type { CorporateIdentity } from "../lib/auth/config";

declare module "next-auth" {
  interface Session { identity?: CorporateIdentity }
}

declare module "next-auth/jwt" {
  interface JWT { identity?: CorporateIdentity; identityExpiresAt?: number }
}
