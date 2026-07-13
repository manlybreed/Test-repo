import { requireCeo, currentUserIsFinanceOwner } from "@/lib/session";
import { CeoShell } from "@/components/ceo-shell";
import { AuthProvider } from "@/components/auth-provider";

export default async function CeoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireCeo();
  const canAccessAgreements = await currentUserIsFinanceOwner();
  return (
    <AuthProvider>
      <CeoShell
        userName={session.user?.name || session.user?.email}
        canAccessAgreements={canAccessAgreements}
      >
        {children}
      </CeoShell>
    </AuthProvider>
  );
}
