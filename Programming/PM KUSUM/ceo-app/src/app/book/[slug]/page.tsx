import { getPublicBookingSlotsAction } from "@/actions/public-booking";
import { PublicBookingFlow } from "@/components/booking/public-booking-flow";

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const info = await getPublicBookingSlotsAction(slug);

  if (!info.found) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ background: "var(--bg-panel)" }}
      >
        <p className="max-w-sm text-center text-sm" style={{ color: "var(--text-dim)" }}>
          This booking link isn&apos;t available.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-panel)" }}>
      <PublicBookingFlow slug={slug} initial={info} />
    </div>
  );
}
