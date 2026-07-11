import Anthropic from "@anthropic-ai/sdk";
import { createAgreement, listAgreements } from "@/actions/agreements";
import { createInvoice, listInvoices } from "@/actions/invoices";
import {
  generateSalarySlip,
  listEmployees,
  upsertEmployee,
} from "@/actions/payroll";
import {
  createTask,
  startPomodoro,
  stopActiveSession,
  logManualTime,
  listTasks,
} from "@/actions/time";
import { createClient, listClients } from "@/actions/clients";
import { listExpenses, getExpenseSummary } from "@/actions/expenses";

export const SYSTEM_PROMPT = `You are the BluRidge CEO Command Center assistant for The BluRidge (BluRidge Consulting Private Limited), a high-reputation project finance advisory firm focused on PM KUSUM solar finance.

You help the CEO with:
- PM KUSUM Finance Advisory & Mandate agreements (DOCX) — use list_agreements to check existing ones
- GST tax invoices (PDF) — ALWAYS call list_invoices to find the latest invoice number before stating it
- Salary slips (PDF) for employees — use list_employees first
- Tasks and Pomodoro / time tracking
- Expense records — use list_expenses or get_expense_summary to answer expense questions

Rules:
- NEVER answer questions about counts, statuses, or amounts from memory — always call the relevant list/summary tool first.
- Ask for missing required fields before calling tools.
- Confirm commercial numbers when the user is ambiguous.
- Default token fee is ₹40,000 per plant + 18% GST; default success fee is 1% (50% at M1 sanction, 50% at M2 disbursement).
- Invoice HSN/SAC default is 998313; CGST+SGST 9% each for same-state (Delhi) buyers, IGST 18% for other states.
- Be concise, professional, and precise. After generating a document, tell the CEO the download path or that it appears in the relevant module.
- Never invent GSTINs or legal names — ask if unknown.
`;

export const ceoTools: Anthropic.Tool[] = [
  {
    name: "create_agreement",
    description:
      "Generate a PM KUSUM Finance Advisory & Mandate Agreement DOCX for a client.",
    input_schema: {
      type: "object",
      properties: {
        clientName: { type: "string" },
        clientAddress: { type: "string" },
        clientGstin: { type: "string" },
        clientPan: { type: "string" },
        spvName: { type: "string" },
        plantCount: { type: "number" },
        tokenFeePerPlant: { type: "number" },
        successFeePct: { type: "number" },
        designatedLender: { type: "string" },
        effectiveDate: { type: "string", description: "YYYY-MM-DD" },
        status: { type: "string", enum: ["DRAFT", "FINAL"] },
      },
      required: ["clientName"],
    },
  },
  {
    name: "create_invoice",
    description: "Create a GST tax invoice PDF for a buyer with line items.",
    input_schema: {
      type: "object",
      properties: {
        buyerName: { type: "string" },
        buyerAddress: { type: "string" },
        buyerGstin: { type: "string" },
        buyerState: { type: "string" },
        buyerStateCode: { type: "string" },
        remarks: { type: "string" },
        invoiceDate: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              hsn: { type: "string" },
              quantity: { type: "number" },
              rate: { type: "number" },
            },
            required: ["description", "rate"],
          },
        },
      },
      required: ["buyerName", "lines"],
    },
  },
  {
    name: "list_invoices",
    description: "List recent invoices, optionally filtered by query.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
    },
  },
  {
    name: "create_salary_slip",
    description:
      "Generate a salary slip PDF. Provide employeeId OR employeeName (must match an existing employee).",
    input_schema: {
      type: "object",
      properties: {
        employeeId: { type: "string" },
        employeeName: { type: "string" },
        month: { type: "number" },
        year: { type: "number" },
      },
      required: ["month", "year"],
    },
  },
  {
    name: "list_employees",
    description: "List employees on payroll.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_employee",
    description: "Add or update an employee with salary structure.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        employeeCode: { type: "string" },
        designation: { type: "string" },
        basic: { type: "number" },
        hra: { type: "number" },
        special: { type: "number" },
        pf: { type: "number" },
        professionalTax: { type: "number" },
        tds: { type: "number" },
      },
      required: ["name", "basic"],
    },
  },
  {
    name: "create_task",
    description: "Create a time-tracker task.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        projectTag: { type: "string" },
        clientTag: { type: "string" },
        estimateMin: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_tasks",
    description: "List CEO tasks.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "start_pomodoro",
    description: "Start a Pomodoro focus session, optionally on a taskId.",
    input_schema: {
      type: "object",
      properties: { taskId: { type: "string" } },
    },
  },
  {
    name: "stop_pomodoro",
    description: "Stop the active Pomodoro / time session.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "log_time",
    description: "Log manual time in minutes against a task.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        durationMin: { type: "number" },
        notes: { type: "string" },
      },
      required: ["durationMin"],
    },
  },
  {
    name: "list_clients",
    description: "List saved clients.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_client",
    description: "Save a client master record.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        addressLine1: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        stateCode: { type: "string" },
        gstin: { type: "string" },
        pan: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_agreements",
    description:
      "List all agreements. Returns id, clientName, status (DRAFT/FINAL), successFeePct, tokenFeePerPlant, plantCount, effectiveDate, filePath. Call this to answer any question about agreements count, statuses, or client details.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["DRAFT", "FINAL"],
          description: "Filter by status. Omit to return all.",
        },
      },
    },
  },
  {
    name: "list_expenses",
    description:
      "List expense records, optionally filtered by category. Returns vendor, amount, date, category, gstAmount, paymentMode, needsReview.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Category ID to filter by. Omit for all.",
        },
      },
    },
  },
  {
    name: "get_expense_summary",
    description:
      "Get a financial summary of all expenses: total spend, this-month spend, spend by category, count, and how many need review.",
    input_schema: { type: "object", properties: {} },
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runCeoTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "create_agreement": {
        const res = await createAgreement(input);
        return JSON.stringify({
          ok: true,
          id: res.id,
          clientName: res.clientName,
          download: `/api/files/${res.filePath}`,
        });
      }
      case "create_invoice": {
        const res = await createInvoice(input);
        return JSON.stringify({
          ok: true,
          number: res.number,
          grandTotal: res.grandTotal,
          download: `/api/files/${res.filePath}`,
        });
      }
      case "list_invoices": {
        const rows = await listInvoices(input.query);
        return JSON.stringify(
          rows.slice(0, 20).map((r) => ({
            number: r.number,
            buyer: r.buyerName,
            total: r.grandTotal,
            date: r.invoiceDate,
            download: r.filePath ? `/api/files/${r.filePath}` : null,
          })),
        );
      }
      case "create_salary_slip": {
        let employeeId = input.employeeId as string | undefined;
        if (!employeeId && input.employeeName) {
          const emps = await listEmployees();
          const match = emps.find(
            (e) =>
              e.name.toLowerCase() ===
              String(input.employeeName).toLowerCase(),
          );
          if (!match) {
            return JSON.stringify({
              ok: false,
              error: `No employee named ${input.employeeName}`,
            });
          }
          employeeId = match.id;
        }
        if (!employeeId) {
          return JSON.stringify({
            ok: false,
            error: "employeeId or employeeName required",
          });
        }
        const res = await generateSalarySlip({
          employeeId,
          month: input.month,
          year: input.year,
        });
        return JSON.stringify({
          ok: true,
          employeeName: res.employeeName,
          netPay: res.netPay,
          download: `/api/files/${res.filePath}`,
        });
      }
      case "list_employees": {
        const emps = await listEmployees();
        return JSON.stringify(
          emps.map((e) => ({
            id: e.id,
            name: e.name,
            code: e.employeeCode,
            designation: e.designation,
            basic: e.basic,
            active: e.active,
          })),
        );
      }
      case "add_employee": {
        const emp = await upsertEmployee(input);
        return JSON.stringify({ ok: true, id: emp.id, name: emp.name });
      }
      case "create_task": {
        const t = await createTask(input);
        return JSON.stringify({ ok: true, id: t.id, title: t.title });
      }
      case "list_tasks": {
        const tasks = await listTasks();
        return JSON.stringify(
          tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            projectTag: t.projectTag,
            clientTag: t.clientTag,
          })),
        );
      }
      case "start_pomodoro": {
        const s = await startPomodoro(input.taskId);
        return JSON.stringify({ ok: true, sessionId: s.id });
      }
      case "stop_pomodoro": {
        const s = await stopActiveSession();
        return JSON.stringify({
          ok: true,
          stopped: Boolean(s),
          durationSec: s?.durationSec,
        });
      }
      case "log_time": {
        const s = await logManualTime(input);
        return JSON.stringify({ ok: true, id: s.id, durationSec: s.durationSec });
      }
      case "list_clients": {
        const clients = await listClients();
        return JSON.stringify(
          clients.map((c) => ({
            id: c.id,
            name: c.name,
            gstin: c.gstin,
            city: c.city,
          })),
        );
      }
      case "create_client": {
        const c = await createClient(input);
        return JSON.stringify({ ok: true, id: c.id, name: c.name });
      }
      case "list_agreements": {
        const rows = await listAgreements();
        const filtered = input.status
          ? rows.filter((r) => r.status === input.status)
          : rows;
        return JSON.stringify(
          filtered.map((r) => ({
            id: r.id,
            clientName: r.clientName,
            status: r.status,
            successFeePct: r.successFeePct,
            tokenFeePerPlant: r.tokenFeePerPlant,
            plantCount: r.plantCount,
            effectiveDate: r.effectiveDate,
            filePath: r.filePath ? `/api/files/${r.filePath}` : null,
            createdAt: r.createdAt,
          })),
        );
      }
      case "list_expenses": {
        const rows = await listExpenses(input.category);
        return JSON.stringify(
          rows.slice(0, 50).map((r) => ({
            id: r.id,
            vendor: r.vendor,
            amount: Number(r.amount),
            date: r.date,
            category: r.category,
            description: r.description,
            gstAmount: r.gstAmount != null ? Number(r.gstAmount) : null,
            paymentMode: r.paymentMode,
            needsReview: r.needsReview,
          })),
        );
      }
      case "get_expense_summary": {
        const summary = await getExpenseSummary();
        return JSON.stringify(summary);
      }
      default:
        return JSON.stringify({ ok: false, error: `Unknown tool ${name}` });
    }
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : "Tool failed",
    });
  }
}
