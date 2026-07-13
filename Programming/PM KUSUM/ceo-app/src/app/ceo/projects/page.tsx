import { listPlantsWithProgress, fetchPlantsRoot } from "@/actions/plant-registry";
import { currentUserIsFinanceOwner } from "@/lib/session";
import { ProjectsClient } from "./client";

export default async function ProjectsPage() {
  const [plants, plantsRoot, canSeeFees] = await Promise.all([
    listPlantsWithProgress(),
    fetchPlantsRoot(),
    currentUserIsFinanceOwner(),
  ]);

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · PM KUSUM
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">PM KUSUM Projects</span>
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Plant document registry: import OneDrive packs or create new plants under your
          plants root. Checklist, files, view/download — plus AI land / section fills.{" "}
          <a href="/ceo/financing" className="underline" style={{ color: "#a5b4fc" }}>
            PM KUSUM Financing →
          </a>
        </p>
      </header>

      <ProjectsClient
        plants={plants}
        plantsRoot={plantsRoot}
        canSeeFees={canSeeFees}
      />
    </div>
  );
}
