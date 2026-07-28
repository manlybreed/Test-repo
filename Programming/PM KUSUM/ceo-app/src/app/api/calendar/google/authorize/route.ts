import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireOwnedAccount, ensureCeoMailAccount } from "@/lib/mail/account";
import { getAuthUrl, googleCalendarConfigured } from "@/lib/calendar/google";

/** Redirects to Google's consent screen for a mailbox's Calendar connection.
 * Navigated to directly from the Calendar settings panel, not a server
 * action — OAuth needs a real browser-navigable redirect. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!googleCalendarConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Calendar isn't configured on this server — GOOGLE_CALENDAR_CLIENT_ID/SECRET must be set.",
      },
      { status: 501 },
    );
  }

  const accountIdParam = req.nextUrl.searchParams.get("accountId");
  const account = accountIdParam
    ? await requireOwnedAccount(accountIdParam, session.user.id).catch(() => null)
    : await ensureCeoMailAccount(session.user.id);

  if (!account) {
    return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  }

  return NextResponse.redirect(getAuthUrl(account.id));
}
