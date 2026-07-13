import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  assertFinanceOwnerEmail,
  isFinanceOwnerEmail,
} from "@/lib/access";

/**
 * For use in Server Components and Layouts only.
 * Redirects to /login if not authenticated.
 */
export async function requireCeo() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session;
}

/**
 * For use in Server Actions called from Client Components.
 * Throws an Error instead of redirecting (redirect() breaks Server Action fetch).
 */
export async function requireCeoAction() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Session expired — please refresh the page and log in again.");
  }
  return session;
}

/** Server Components: agreements + plant fee data. */
export async function requireFinanceOwner() {
  const session = await requireCeo();
  if (!isFinanceOwnerEmail(session.user?.email)) {
    redirect("/ceo");
  }
  return session;
}

/** Server Actions: agreements + plant fee mutations/reads. */
export async function requireFinanceOwnerAction() {
  const session = await requireCeoAction();
  assertFinanceOwnerEmail(session.user?.email);
  return session;
}

export async function currentUserIsFinanceOwner(): Promise<boolean> {
  const session = await auth();
  return isFinanceOwnerEmail(session?.user?.email);
}
