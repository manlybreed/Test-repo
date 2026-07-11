import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isCeo = req.nextUrl.pathname.startsWith("/ceo");
  const isLogin = req.nextUrl.pathname.startsWith("/login");

  if (isCeo && !req.auth) {
    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (isLogin && req.auth) {
    return NextResponse.redirect(new URL("/ceo", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/ceo/:path*", "/login"],
};
