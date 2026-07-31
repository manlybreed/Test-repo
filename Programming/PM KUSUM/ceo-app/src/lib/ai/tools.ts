import Anthropic from "@anthropic-ai/sdk";
import { createAgreement, listAgreements } from "@/actions/agreements";
import {
  createInvoice,
  issueRefundViaCreditNote,
  listInvoices,
  validateDraftAction,
} from "@/actions/invoices";
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
- GST documents (tax invoice / proforma / credit notes) — ALWAYS call list_invoices before stating numbers; never invent tax %; refunds require credit notes (use refund_via_credit_note); validate with validate_invoice_draft before create when unsure
- Salary slips (PDF) for employees — use list_employees first
- Tasks and Pomodoro / time tracking
- Expense records — use list_expenses or get_expense_summary to answer expense questions
- CEO Mail (akshay@) — use search_mail / ask_mail / digest_inbox / summarize_thread / draft_reply / propose_tasks_from_mail / recall_person to read and draft. archive_mail_thread / move_mail_thread_to_folder / set_mail_priority / mark_mail_important / mark_mail_read / mark_mail_spam / mark_mail_not_spam / snooze_mail_thread are reversible mail actions you can call directly once you have a threadId (get it from search_mail). trash_mail_thread / bulk_trash_mail_threads / send_mail are irreversible — calling them never executes anything by itself, the CEO sees a confirmation card with the exact details and must click Confirm; call them as soon as you have the required details, do not withhold the call to ask permission first. send_mail is for a brand-new email only, never a reply to an existing thread — resolve the recipient address via search_mail/list_clients/recall_person first, never guess one.
- Calendar & meetings — use check_calendar_availability before proposing or discussing any time; it returns ready-made slots with an exact startIso/endIso already confirmed against real availability. When scheduling, copy that startIso/endIso verbatim into schedule_meeting — never recompute or retype a date/time yourself, even one that looks equivalent to a slot you saw. schedule_meeting creates a real Calendar event with a Meet link and sends real invites (or falls back to a downloadable .ics if Calendar isn't connected). It is irreversible, so calling it never executes it directly — the CEO always sees a confirmation card with the exact details and must click Confirm themselves before anything is actually created. Call schedule_meeting as soon as you have a specific time and attendee list; you do not need to ask "shall I confirm?" first — the card handles that.

Irreversible tools (schedule_meeting, and any mail send/delete tool) never execute on your tool call alone — a confirmation card with the exact details is shown to the CEO, and only a real click by them triggers the action. Call these tools freely once you have the required details; do not withhold the call to ask permission first, and do not claim an action is done until you see its actual tool result.

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
    description:
      "Issue a GST document (TAX_INVOICE or PROFORMA). Numbers/tax come from the engine. Requires buyerStateCode (place of supply).",
    input_schema: {
      type: "object",
      properties: {
        buyerName: { type: "string" },
        buyerAddress: { type: "string" },
        buyerGstin: { type: "string" },
        buyerState: { type: "string" },
        buyerStateCode: { type: "string", description: "2-digit POS state code" },
        remarks: { type: "string" },
        invoiceDate: { type: "string" },
        gstEntity: { type: "string", enum: ["DEL", "RAJ"] },
        documentType: { type: "string", enum: ["TAX_INVOICE", "PROFORMA"] },
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
      required: ["buyerName", "buyerStateCode", "lines"],
    },
  },
  {
    name: "validate_invoice_draft",
    description: "Validate a draft invoice for Rule 46 / GSTIN issues before issuing.",
    input_schema: {
      type: "object",
      properties: {
        buyerName: { type: "string" },
        buyerGstin: { type: "string" },
        buyerStateCode: { type: "string" },
        gstEntity: { type: "string" },
        documentType: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              rate: { type: "number" },
              quantity: { type: "number" },
              hsn: { type: "string" },
            },
            required: ["description", "rate"],
          },
        },
      },
      required: ["buyerName", "lines"],
    },
  },
  {
    name: "refund_via_credit_note",
    description:
      "GST-compliant refund: issue a Credit Note against an issued tax invoice (by id). Never deletes the original.",
    input_schema: {
      type: "object",
      properties: {
        invoiceId: { type: "string" },
        reason: { type: "string" },
        partialAmount: { type: "number" },
        refundMode: { type: "string" },
        refundReference: { type: "string" },
      },
      required: ["invoiceId"],
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
        phone: { type: "string" },
        email: { type: "string" },
        emailOfficial: { type: "string" },
        basic: { type: "number" },
        hra: { type: "number" },
        special: { type: "number" },
        pf: { type: "number" },
        professionalTax: { type: "number" },
        tdsPercent: { type: "number", description: "TDS rate as percent of gross" },
      },
      required: ["name", "basic", "phone", "emailOfficial"],
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
  {
    name: "search_mail",
    description:
      "Search the CEO mailbox (akshay@) by natural language / keywords. Returns message snippets with ids for citation.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "ask_mail",
    description:
      "Answer a question about the CEO mailbox using retrieval-grounded RAG with message citations. Prefer this over guessing.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
    },
  },
  {
    name: "digest_inbox",
    description:
      "Build a priority-grouped digest of recent inbox mail (AI-04).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "summarize_thread",
    description: "Summarize a mail thread by threadId with citations.",
    input_schema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
  },
  {
    name: "draft_reply",
    description:
      "Draft an HTML reply for a thread. Does NOT send — user must confirm in Mail UI.",
    input_schema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        intent: { type: "string" },
        tone: { type: "string" },
      },
      required: ["threadId"],
    },
  },
  {
    name: "propose_tasks_from_mail",
    description:
      "Extract commitment/task proposals from a thread. Does not create tasks until user accepts in Mail UI.",
    input_schema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
  },
  {
    name: "recall_person",
    description: "What did I last discuss with this person across mail threads?",
    input_schema: {
      type: "object",
      properties: { person: { type: "string" } },
      required: ["person"],
    },
  },
  {
    name: "archive_mail_thread",
    description:
      "Archive a mail thread (resolve threadId via search_mail first). Reversible — moves it to Archive, doesn't delete anything.",
    input_schema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
  },
  {
    name: "move_mail_thread_to_folder",
    description:
      "Move a mail thread to a folder or label by name (e.g. 'Invoices', 'Archive', 'Inbox'). Reversible.",
    input_schema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        folderName: { type: "string" },
      },
      required: ["threadId", "folderName"],
    },
  },
  {
    name: "set_mail_priority",
    description: "Set a mail thread's priority label. Reversible.",
    input_schema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        priority: { type: "string", enum: ["P1", "P2", "P3", "P4", "NONE"] },
      },
      required: ["threadId", "priority"],
    },
  },
  {
    name: "mark_mail_important",
    description: "Star/unstar a mail thread as important. Reversible.",
    input_schema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        important: { type: "boolean" },
      },
      required: ["threadId", "important"],
    },
  },
  {
    name: "mark_mail_read",
    description: "Mark a mail thread's inbox messages as read. Reversible.",
    input_schema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
  },
  {
    name: "mark_mail_spam",
    description:
      "Move a mail thread to Junk/Spam (resolve threadId via search_mail first). Reversible — moves it out of the inbox, doesn't delete anything.",
    input_schema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
  },
  {
    name: "mark_mail_not_spam",
    description:
      "Move a mail thread out of Junk/Spam back into the inbox — use when the CEO says a thread was wrongly filed as spam. Reversible.",
    input_schema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
  },
  {
    name: "snooze_mail_thread",
    description: "Snooze a mail thread until a given ISO datetime. Reversible.",
    input_schema: {
      type: "object",
      properties: {
        threadId: { type: "string" },
        untilIso: { type: "string", description: "ISO 8601 datetime to resurface the thread" },
      },
      required: ["threadId", "untilIso"],
    },
  },
  {
    name: "trash_mail_thread",
    description:
      "Move a single mail thread to Trash. Irreversible from here — the CEO sees a confirmation card and must click Confirm before anything is actually trashed.",
    input_schema: {
      type: "object",
      properties: { threadId: { type: "string" } },
      required: ["threadId"],
    },
  },
  {
    name: "bulk_trash_mail_threads",
    description:
      "Move multiple mail threads to Trash at once. Irreversible from here — the CEO sees a confirmation card and must click Confirm before anything is actually trashed.",
    input_schema: {
      type: "object",
      properties: { threadIds: { type: "array", items: { type: "string" } } },
      required: ["threadIds"],
    },
  },
  {
    name: "send_mail",
    description:
      "Send a brand-new email from the CEO mailbox (akshay@) — not for replying to an existing thread (use draft_reply + the Mail UI for that). Resolve recipient addresses via search_mail/list_clients/recall_person first — never guess an email address. Irreversible — sending never happens from your tool call alone; the CEO sees a confirmation card with the exact recipient, subject, and body and must click Confirm before anything is actually sent.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" } },
        cc: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        bodyHtml: { type: "string", description: "Email body as HTML" },
      },
      required: ["to", "subject", "bodyHtml"],
    },
  },
  {
    name: "check_calendar_availability",
    description:
      "Get real, ready-to-use open meeting slots for the next N days (default 7) — each returned slot already has an exact startIso/endIso confirmed against actual Google Calendar availability, plus a human-readable label. Call this before proposing or discussing any meeting time. When presenting or scheduling a slot, copy its startIso/endIso EXACTLY as returned — never recompute, retype, or guess a date/time yourself, even one that looks equivalent; that is how a real meeting once got scheduled a year in the wrong direction.",
    input_schema: {
      type: "object",
      properties: {
        withinDays: {
          type: "number",
          description: "How many days ahead to check. Defaults to 7.",
        },
      },
    },
  },
  {
    name: "schedule_meeting",
    description:
      "Propose scheduling a real meeting: creates a Google Calendar event with a Meet link and sends invites to attendees (falls back to a downloadable .ics if Calendar isn't connected). startIso/endIso MUST be copied verbatim from a slot check_calendar_availability already returned — never computed or retyped. Irreversible — calling this never schedules anything by itself; the CEO sees a confirmation card with these exact details and must click Confirm before the event is actually created.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        startIso: { type: "string", description: "ISO 8601 start datetime" },
        endIso: { type: "string", description: "ISO 8601 end datetime" },
        attendeeEmails: { type: "array", items: { type: "string" } },
      },
      required: ["title", "startIso", "endIso", "attendeeEmails"],
    },
  },
];

export { CONFIRMATION_REQUIRED_TOOLS, describePendingAction } from "./tool-confirmation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runCeoTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "create_agreement": {
        const { currentUserIsFinanceOwner } = await import("@/lib/session");
        if (!(await currentUserIsFinanceOwner())) {
          return JSON.stringify({
            ok: false,
            error: "Agreements are restricted to the finance owner.",
          });
        }
        const res = await createAgreement(input);
        return JSON.stringify({
          ok: true,
          id: res.id,
          clientName: res.clientName,
          download: `/api/files/${res.filePath}`,
        });
      }
      case "create_invoice": {
        const res = await createInvoice({
          ...input,
          placeOfSupplyStateCode: input.buyerStateCode,
          placeOfSupplyState: input.buyerState,
          documentType: input.documentType === "PROFORMA" ? "PROFORMA" : "TAX_INVOICE",
        });
        return JSON.stringify({
          ok: true,
          number: res.number,
          documentType: res.documentType,
          grandTotal: res.grandTotal,
          download: res.filePath ? `/api/files/${res.filePath}` : null,
          warnings: res.validationWarnings,
        });
      }
      case "validate_invoice_draft": {
        const res = await validateDraftAction({
          ...input,
          documentType:
            input.documentType === "PROFORMA" ? "PROFORMA" : "TAX_INVOICE",
          placeOfSupplyStateCode: input.buyerStateCode,
          useAi: false,
        });
        return JSON.stringify(res);
      }
      case "refund_via_credit_note": {
        const res = await issueRefundViaCreditNote(input);
        return JSON.stringify({
          ok: true,
          creditNote: res.number,
          grandTotal: res.grandTotal,
          download: res.filePath ? `/api/files/${res.filePath}` : null,
        });
      }
      case "list_invoices": {
        const rows = await listInvoices(input.query);
        return JSON.stringify(
          rows.slice(0, 20).map((r) => ({
            id: r.id,
            number: r.number,
            documentType: r.documentType,
            status: r.status,
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
        const raw = input as Record<string, unknown>;
        const emp = await upsertEmployee({
          name: String(raw.name ?? ""),
          employeeCode: raw.employeeCode ? String(raw.employeeCode) : undefined,
          designation: raw.designation ? String(raw.designation) : undefined,
          phone: String(raw.phone ?? "0000000000"),
          email: raw.email ? String(raw.email) : undefined,
          emailOfficial: raw.emailOfficial ? String(raw.emailOfficial) : undefined,
          basic: Number(raw.basic ?? 0),
          hra: raw.hra != null ? Number(raw.hra) : undefined,
          special: raw.special != null ? Number(raw.special) : undefined,
          pf: raw.pf != null ? Number(raw.pf) : undefined,
          professionalTax: raw.professionalTax != null ? Number(raw.professionalTax) : undefined,
          tdsPercent:
            raw.tdsPercent != null
              ? Number(raw.tdsPercent)
              : raw.tds != null
                ? Number(raw.tds)
                : 0,
        });
        return JSON.stringify({ ok: true, id: emp.id, name: emp.name, code: emp.employeeCode });
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
        const { currentUserIsFinanceOwner } = await import("@/lib/session");
        if (!(await currentUserIsFinanceOwner())) {
          return JSON.stringify({
            ok: false,
            error: "Agreements are restricted to the finance owner.",
          });
        }
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
      case "search_mail": {
        const { searchMailAction } = await import("@/actions/mail");
        const rows = await searchMailAction(input.query);
        return JSON.stringify(rows.slice(0, 20));
      }
      case "ask_mail": {
        const { askMailAction } = await import("@/actions/mail");
        return JSON.stringify(await askMailAction(input.question));
      }
      case "digest_inbox": {
        const { digestAction } = await import("@/actions/mail");
        return JSON.stringify(await digestAction());
      }
      case "summarize_thread": {
        const { summarizeThreadAction } = await import("@/actions/mail");
        return JSON.stringify(await summarizeThreadAction(input.threadId));
      }
      case "draft_reply": {
        const { draftReplyAction } = await import("@/actions/mail");
        const draft = await draftReplyAction({
          threadId: input.threadId,
          intent: input.intent,
          tone: input.tone,
        });
        return JSON.stringify({
          ok: true,
          draft,
          note: "Not sent — confirm in /ceo/mail",
        });
      }
      case "propose_tasks_from_mail": {
        const { extractCommitmentsAction } = await import("@/actions/mail");
        return JSON.stringify(await extractCommitmentsAction(input.threadId));
      }
      case "recall_person": {
        const { recallPersonAction } = await import("@/actions/mail");
        return JSON.stringify(await recallPersonAction(input.person));
      }
      case "archive_mail_thread": {
        const { archiveThreadAction } = await import("@/actions/mail");
        await archiveThreadAction(input.threadId);
        return JSON.stringify({ ok: true });
      }
      case "move_mail_thread_to_folder": {
        const { listMailFolders, moveThreadToFolderAction } = await import(
          "@/actions/mail"
        );
        const folders = await listMailFolders();
        const target = String(input.folderName || "").trim().toLowerCase();
        const folder = folders.find(
          (f) =>
            f.name.toLowerCase() === target ||
            (f.role || "").toLowerCase() === target,
        );
        if (!folder) {
          return JSON.stringify({
            ok: false,
            error: `No folder named "${input.folderName}"`,
          });
        }
        await moveThreadToFolderAction(input.threadId, folder.id);
        return JSON.stringify({ ok: true, folder: folder.name });
      }
      case "set_mail_priority": {
        const { setThreadPriority } = await import("@/actions/mail");
        await setThreadPriority(input.threadId, input.priority);
        return JSON.stringify({ ok: true });
      }
      case "mark_mail_important": {
        const { setThreadImportant } = await import("@/actions/mail");
        await setThreadImportant(input.threadId, Boolean(input.important));
        return JSON.stringify({ ok: true });
      }
      case "mark_mail_read": {
        const { markThreadRead } = await import("@/actions/mail");
        await markThreadRead(input.threadId);
        return JSON.stringify({ ok: true });
      }
      case "mark_mail_spam": {
        const { markThreadSpamAction } = await import("@/actions/mail");
        await markThreadSpamAction(input.threadId);
        return JSON.stringify({ ok: true });
      }
      case "mark_mail_not_spam": {
        const { markThreadNotSpamAction } = await import("@/actions/mail");
        await markThreadNotSpamAction(input.threadId);
        return JSON.stringify({ ok: true });
      }
      case "snooze_mail_thread": {
        const { snoozeThread } = await import("@/actions/mail");
        await snoozeThread(input.threadId, input.untilIso);
        return JSON.stringify({ ok: true });
      }
      case "trash_mail_thread": {
        const { trashThreadAction } = await import("@/actions/mail");
        await trashThreadAction(input.threadId, Boolean(input.confirmed));
        return JSON.stringify({ ok: true });
      }
      case "bulk_trash_mail_threads": {
        const { trashThreadsAction } = await import("@/actions/mail");
        const ids: string[] = Array.isArray(input.threadIds) ? input.threadIds : [];
        await trashThreadsAction(ids, Boolean(input.confirmed));
        return JSON.stringify({ ok: true, count: ids.length });
      }
      case "send_mail": {
        const { sendMailAction, flushQueuedSendAction } = await import(
          "@/actions/mail"
        );
        const row = await sendMailAction({
          to: input.to || [],
          cc: input.cc,
          subject: input.subject,
          bodyHtml: input.bodyHtml,
          confirmed: Boolean(input.confirmed),
          undoWindowSeconds: 3,
        });
        // No client-side undo-window timer exists for an AI-initiated send
        // (that timer lives in mail-client.tsx's own component state) — so
        // this dispatches the queued send immediately server-side instead
        // of leaving it stuck QUEUED forever waiting for a timer that will
        // never fire.
        if (row.status !== "QUEUED") {
          return JSON.stringify({
            ok: false,
            error: `Unexpected send status: ${row.status}`,
          });
        }
        const flushed = await flushQueuedSendAction(row.id);
        return JSON.stringify({
          ok: flushed.status === "SENT",
          status: flushed.status,
          to: input.to,
          subject: input.subject,
          error: flushed.status === "FAILED" ? flushed.error : undefined,
        });
      }
      case "check_calendar_availability": {
        const { getCalendarAvailabilityAction } = await import("@/actions/calendar");
        return JSON.stringify(await getCalendarAvailabilityAction(input.withinDays));
      }
      case "schedule_meeting": {
        const { createMeetingAction } = await import("@/actions/calendar");
        const result = await createMeetingAction({
          title: input.title,
          description: input.description,
          startIso: input.startIso,
          endIso: input.endIso,
          attendeeEmails: input.attendeeEmails || [],
          confirmed: Boolean(input.confirmed),
        });
        return JSON.stringify(result);
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
