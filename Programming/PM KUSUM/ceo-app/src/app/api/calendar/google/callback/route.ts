import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireOwnedAccount } from "@/lib/mail/account";
import { exchangeCodeForTokens, saveConnection } from "@/lib/calendar/google";

function redirectWithStatus(req: NextRequest, status: "connected" | "error", message?: string) {
  const url = new URL("/ceo/mail", req.url);
  url.searchParams.set("calendar", status);
  if (message) url.searchParams.set("calendarError", message);
  return NextResponse.redirect(url);
}

/** OAuth redirect target — exchanges the auth code for tokens and stores
 * the connection. `state` carries the accountId set by the authorize
 * route; re-verified against the session here rather than trusted blindly,
 * since it's a value that round-trips through Google, not this server. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const params = req.nextUrl.searchParams;
  const error = params.get("error");
  if (error) {
    return redirectWithStatus(req, "error", `Google sign-in was cancelled or denied (${error}).`);
  }

  const code = params.get("code");
  const accountId = params.get("state");
  if (!code || !accountId) {
    return redirectWithStatus(req, "error", "Missing code or state from Google's redirect.");
  }

  const account = await requireOwnedAccount(accountId, session.user.id).catch(() => null);
  if (!account) {
    return redirectWithStatus(req, "error", "Mailbox not found.");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveConnection(account.id, tokens);
  } catch (e) {
    return redirectWithStatus(
      req,
      "error",
      e instanceof Error ? e.message : "Failed to connect Google Calendar.",
    );
  }

  return redirectWithStatus(req, "connected");
}
