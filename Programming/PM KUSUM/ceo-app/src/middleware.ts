import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isFinanceOwnerEmail } from "@/lib/access";

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
