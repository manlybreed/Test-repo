import { listAgreements } from "@/actions/agreements";
import { listClientsWithAgreements } from "@/actions/clients";
import { requireFinanceOwner } from "@/lib/session";
import { AgreementsWorkspace } from "./client";

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; clientId?: string }>;
}) {
  await requireFinanceOwner();
  const sp = await searchParams;
  const [agreements, clientsRaw] = await Promise.all([
    listAgreements(),
    listClientsWithAgreements(),
  ]);

  const clients = clientsRaw.map((c) => ({
    id: c.id,
    name: c.name,
    addressLine1: c.addressLine1,
    city: c.city,
    state: c.state,
    gstin: c.gstin,
    pan: c.pan,
    phone: c.phone,
    pocName: c.pocName,
    email: c.email,
    agreementCount: c.agreementCount,
  }));

  const agreementRows = agreements.map((a) => {
    const inputs =
      a.inputsJson && typeof a.inputsJson === "object"
        ? (a.inputsJson as Record<string, unknown>)
        : {};
    const legacyUploaded = inputs.uploaded === true || inputs.isImported === true;
    return {
      id: a.id,
      clientId: a.clientId,
      clientName: a.clientName,
      spvName: a.spvName,
      tokenFeePerPlant: a.tokenFeePerPlant,
      plantCount: a.plantCount,
      successFeePct: a.successFeePct,
      effectiveDate: a.effectiveDate.toISOString(),
      status: a.status,
      filePath: a.filePath,
      isImported: a.isImported || legacyUploaded,
      notes: a.notes,
      inputsJson: a.inputsJson,
    };
  });

  return (
    <AgreementsWorkspace
      clients={clients}
      agreements={agreementRows}
      initialClientId={sp.clientId}
      createdId={sp.created}
    />
  );
}
