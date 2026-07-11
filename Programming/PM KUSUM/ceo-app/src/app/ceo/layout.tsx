import { requireCeo } from "@/lib/session";
import { CeoShell } from "@/components/ceo-shell";
import { AuthProvider } from "@/components/auth-provider";

export default async function CeoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireCeo();
  return (
    <AuthProvider>
      <CeoShell userName={session.user?.name || session.user?.email}>
        {children}
      </CeoShell>
    </AuthProvider>
  );
}
