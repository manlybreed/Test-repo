"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";

export async function createTask(input: {
  title: string;
  description?: string;
  projectTag?: string;
  clientTag?: string;
  estimateMin?: number;
}) {
  const session = await requireCeo();
  if (!input.title?.trim()) throw new Error("Title is required");

  const task = await prisma.task.create({
    data: {
      userId: session.user.id,
      title: input.title.trim(),
      description: input.description || null,
      projectTag: input.projectTag || null,
      clientTag: input.clientTag || null,
      estimateMin: input.estimateMin ?? null,
      status: "TODO",
    },
  });
  revalidatePath("/ceo/time");
  return task;
}

export async function updateTask(
  id: string,
  input: {
    title?: string;
    description?: string;
    projectTag?: string;
    clientTag?: string;
    estimateMin?: number | null;
    status?: "TODO" | "IN_PROGRESS" | "DONE";
  },
) {
  await requireCeo();
  if (input.title !== undefined && !input.title.trim()) {
    throw new Error("Title is required");
  }
  await prisma.task.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description || null }
        : {}),
      ...(input.projectTag !== undefined
        ? { projectTag: input.projectTag || null }
        : {}),
      ...(input.clientTag !== undefined
        ? { clientTag: input.clientTag || null }
        : {}),
      ...(input.estimateMin !== undefined
        ? { estimateMin: input.estimateMin }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });
  revalidatePath("/ceo/time");
}

export async function deleteTask(id: string) {
  await requireCeo();
  await prisma.task.delete({ where: { id } });
  revalidatePath("/ceo/time");
  return { ok: true };
}

export async function updateTaskStatus(
  id: string,
  status: "TODO" | "IN_PROGRESS" | "DONE",
) {
  await requireCeo();
  await prisma.task.update({ where: { id }, data: { status } });
  revalidatePath("/ceo/time");
}

export async function listTasks() {
  const session = await requireCeo();
  return prisma.task.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      sessions: {
        where: { endedAt: { not: null } },
        select: { durationSec: true },
      },
    },
  });
}

export async function startPomodoro(taskId?: string) {
  const session = await requireCeo();

  await prisma.timeSession.updateMany({
    where: { userId: session.user.id, endedAt: null },
    data: { endedAt: new Date() },
  });

  if (taskId) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "IN_PROGRESS" },
    });
  }

  const timeSession = await prisma.timeSession.create({
    data: {
      userId: session.user.id,
      taskId: taskId || null,
      kind: "POMODORO",
      startedAt: new Date(),
    },
  });

  revalidatePath("/ceo/time");
  return timeSession;
}

export async function stopActiveSession() {
  const session = await requireCeo();
  const active = await prisma.timeSession.findFirst({
    where: { userId: session.user.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!active) return null;

  const endedAt = new Date();
  const durationSec = Math.max(
    1,
    Math.round((endedAt.getTime() - active.startedAt.getTime()) / 1000),
  );

  const updated = await prisma.timeSession.update({
    where: { id: active.id },
    data: { endedAt, durationSec },
  });

  revalidatePath("/ceo/time");
  return updated;
}

export async function logManualTime(input: {
  taskId?: string;
  durationMin: number;
  notes?: string;
  startedAt?: string;
}) {
  const session = await requireCeo();
  const durationSec = Math.round(input.durationMin * 60);
  const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
  const endedAt = new Date(startedAt.getTime() + durationSec * 1000);

  const row = await prisma.timeSession.create({
    data: {
      userId: session.user.id,
      taskId: input.taskId || null,
      kind: "MANUAL",
      startedAt,
      endedAt,
      durationSec,
      notes: input.notes || null,
    },
  });
  revalidatePath("/ceo/time");
  return row;
}

export async function getActiveSession() {
  const session = await requireCeo();
  return prisma.timeSession.findFirst({
    where: { userId: session.user.id, endedAt: null },
    include: { task: true },
  });
}

export async function getWeeklySummary() {
  const session = await requireCeo();
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const sessions = await prisma.timeSession.findMany({
    where: {
      userId: session.user.id,
      endedAt: { not: null },
      startedAt: { gte: start },
    },
    include: { task: true },
  });

  const byTag: Record<string, number> = {};
  let totalSec = 0;
  for (const s of sessions) {
    const sec = s.durationSec || 0;
    totalSec += sec;
    const tag = s.task?.clientTag || s.task?.projectTag || s.task?.title || "Untagged";
    byTag[tag] = (byTag[tag] || 0) + sec;
  }

  return { totalSec, byTag, sessions };
}
