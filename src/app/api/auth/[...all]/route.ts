import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

// Mounts all Better Auth endpoints (sign-in, sign-out, forget/reset password,
// get-session, …) under /api/auth/*. There is deliberately NO sign-up route
// exposed for account creation — signup is disabled and accounts are created
// only by accepting an Admin invite (see src/lib/identity).
export const { GET, POST } = toNextJsHandler(auth);
