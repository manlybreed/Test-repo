import { listClientsWithAgreements } from "@/actions/clients";
import { ClientsWorkspace } from "./client";

export default async function ClientsPage() {
  const clients = await listClientsWithAgreements();

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · Clients
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Clients</span>
        </h1>
        <p className="text-sm max-w-lg" style={{ color: "var(--text-muted)" }}>
          Company master data, PoC contacts, and agreement shortcuts in one place.
        </p>
      </header>

      <ClientsWorkspace clients={clients} />
    </div>
  );
}
