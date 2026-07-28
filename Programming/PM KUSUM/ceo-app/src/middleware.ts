import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isFinanceOwnerEmail } from "@/lib/access";

// Node.js runtime, not the Edge default — this app's instrumentation.ts
// bootstraps IMAP IDLE via a Node-only dependency chain (imapflow, fs,
// crypto, net), and Next needs an Edge-compiled instrumentation bundle
// for any Edge middleware, which fundamentally cannot include those
// regardless of serverExternalPackages. That's what was actually
// breaking `next build`/`npm run desktop:build`, not a missing
// serverExternalPackages entry — this middleware doesn't need Edge's
// low-latency characteristics anyway (a single auth check).
export const runtime = "nodejs";

export default auth((req) => {
  const isCeo = req.nextUrl.pathname.startsWith("/ceo");
  const isLogin = req.nextUrl.pathname.startsWith("/login");
  const isAgreements = req.nextUrl.pathname.startsWith("/ceo/agreements");

  if (isCeo && !req.auth) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (isAgreements && req.auth && !isFinanceOwnerEmail(req.auth.user?.email)) {
    return NextResponse.redirect(new URL("/ceo", req.url));
  }

  if (isLogin && req.auth) {
    return NextResponse.redirect(new URL("/ceo", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/ceo/:path*", "/login"],
};
