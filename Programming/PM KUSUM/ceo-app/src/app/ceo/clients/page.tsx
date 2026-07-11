import { listClients } from "@/actions/clients";
import { BuyerForm } from "@/components/buyer-form";

export default async function ClientsPage() {
  const clients = await listClients();

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · Buyers
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Buyers</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Add buyers manually or upload COI, PAN, GST and other KYC documents — AI fills the profile.
        </p>
      </header>

      <div className="grid lg:grid-cols-5 gap-6 mb-10">
        <section
          className="lg:col-span-3 rounded-xl p-5"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-base font-semibold mb-1">Add new buyer</h2>
          <p className="text-xs mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
            Documents: Certificate of Incorporation, PAN, GST REG-06, address proof…
          </p>
          <BuyerForm />
        </section>

        <aside
          className="lg:col-span-2 rounded-xl p-5 h-fit"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-base font-semibold">Saved buyers</h2>
            <span
              className="text-xs px-2 py-0.5 rounded-md tabular-nums"
              style={{
                background: "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.25)",
                color: "#a5b4fc",
              }}
            >
              {clients.length}
            </span>
          </div>

          {clients.length === 0 ? (
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              No buyers yet. Add one from documents or manually.
            </p>
          ) : (
            <ul className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              {clients.map((c) => (
                <li
                  key={c.id}
                  className="rounded-lg p-3"
                  style={{
                    background: "rgba(255,255,255,0.025)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <p className="text-sm font-semibold leading-snug">{c.name}</p>
                  {(c.gstin || c.pan) && (
                    <p className="text-[0.68rem] font-mono mt-1 tabular-nums" style={{ color: "rgba(255,255,255,0.5)" }}>
                      {[c.gstin, c.pan].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {(c.city || c.state) && (
                    <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {[c.city, c.state, c.stateCode].filter(Boolean).join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
