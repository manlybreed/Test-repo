"use client";

// SessionProvider removed — the app uses server-side JWT auth via cookies.
// All auth checks happen in Server Components / Server Actions via auth().
// Keeping this wrapper in case client-side useSession() is needed in future.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
