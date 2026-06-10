"use server";

import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/identity/current-principal";
import { createClient, ClientAccessError } from "./repository";

// Server action behind the Admin "new client" form. Pure wiring: authenticate →
// hand the name to the principal-scoped repository, which owns the Admin gate
// (domains/authz/clients). Returns a discriminated result the form renders
// inline, matching the project's action convention.

export type CreateClientResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string };

export async function createClientAction(
  _prev: CreateClientResult | null,
  formData: FormData,
): Promise<CreateClientResult> {
  const principal = await requirePrincipal();
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") return { ok: false, error: "Enter a company name." };

  try {
    const client = await createClient(principal, name);
    revalidatePath("/admin");
    return { ok: true, id: client.id, name: client.name };
  } catch (error) {
    if (error instanceof ClientAccessError) return { ok: false, error: error.message };
    throw error;
  }
}
