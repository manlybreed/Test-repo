import {
  getFinancingDashboard,
} from "@/actions/plant-registry";
import { FinancingClient } from "./client";

export default async function FinancingPage() {
  const dashboard = await getFinancingDashboard();

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · PM KUSUM Financing
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">PM KUSUM Financing</span>
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Set target income by vertical. Deals required are derived from average fee
          payout — using tariff, capacity, and sanction averages from the portfolio.
        </p>
      </header>

      <FinancingClient initial={dashboard} />
    </div>
  );
}
