import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

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
