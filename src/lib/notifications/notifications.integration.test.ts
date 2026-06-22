import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  createMarketQuote,
  addQuoteLine,
  submitMarketQuote,
  rejectLine,
  approveLine,
  type MarketQuoteHeaderFields,
} from "@/lib/quotes/repository";
import { createStudy } from "@/lib/studies/repository";
import { assignResearchers } from "@/lib/assignments/repository";
import { releaseCountry, reopenCountry } from "@/lib/release/repository";
import { listNotifications, unreadCount, markAllRead } from "./inbox";
import { sendNotificationEmail } from "./send";
import { sendEmail } from "@/lib/notifications";
import type { InternalPrincipal, ClientPrincipal } from "@/domains/authz/principal";

// Email delivery is an external boundary (the Resend vendor); spy on the port so
// the worker step is testable without sending real mail. The dispatch/release/
// reject paths never call sendEmail (email is deferred), so this mock is inert
// for every other test in this file.
vi.mock("@/lib/notifications", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

// Real-Postgres proof of the two v1 push events (#17 / ADR-0020). The pure
// builders are unit-tested in src/domains/notifications; this suite proves what
// the core can't: recipient resolution (author, not Primary Researcher; active
// only), the in-transaction Notification write, the transactional email enqueue,
// and the first-release-only suppression. Runs via `npm run test:integration`.

const prisma = new PrismaClient();

let tenantId: string;
let em: InternalPrincipal;
let analyst: InternalPrincipal;
let author: InternalPrincipal; // creates the quotes that get rejected
let deactivatedUserId: string; // an offboarded author — never notified
let clientUser1: string; // active Client User of the tenant
let clientUser2: string; // active Client User of the tenant
let clientUserOff: string; // deactivated Client User — never notified
let studyId: string;
let itemId: string;

const header: MarketQuoteHeaderFields = {
  sourceName: "Acme Equipment",
  sourceLocation: "Munich",
  currency: "EUR",
  dateQuoteReceived: new Date("2026-06-01"),
};
const lineFields = { competitorBrand: "Caterpillar", price: 1250.5, quantityQuoted: 1 };

/** Create a one-line document on `item` (in its own country) and return its line id. */
async function makeLine(item: string): Promise<string> {
  const it = await prisma.benchmarkItem.findUniqueOrThrow({ where: { id: item }, select: { country: true } });
  const doc = await createMarketQuote(author, studyId, it.country, header);
  const { id } = await addQuoteLine(author, doc.id, item, lineFields);
  return id;
}

async function seedUser(
  kind: "internal" | "client",
  opts: { role?: InternalPrincipal["role"]; tenantId?: string; status?: "active" | "deactivated" },
): Promise<string> {
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: opts.role ?? "client-user",
      email: `${opts.role ?? "cu"}-${id}@example.test`,
      emailVerified: true,
      kind,
      role: opts.role ?? null,
      tenantId: opts.tenantId ?? null,
      status: opts.status ?? "active",
      deactivatedAt: opts.status === "deactivated" ? new Date() : null,
    },
  });
  return id;
}

/** A Submitted Quote Line authored by `author`, ready to reject. */
async function submittedQuote(): Promise<string> {
  const id = await makeLine(itemId);
  const { marketQuoteId } = await prisma.quoteLine.findUniqueOrThrow({
    where: { id },
    select: { marketQuoteId: true },
  });
  await submitMarketQuote(author, marketQuoteId);
  return id;
}

/** A fresh Country in the study with one Benchmark Item (requiredQuotes 1), the
 *  author in its pool. Each release test uses its own Country so clientNotifiedAt
 *  starts null (independent of other tests). Returns the item id. */
async function seedCountry(country: string): Promise<string> {
  const id = (
    await prisma.benchmarkItem.create({
      data: {
        studyId,
        clientId: tenantId,
        country,
        clientItemNumber: `PN-${country}`,
        clientItemNumberKey: `pn-${country.toLowerCase()}`,
        itemDescription: "Widget",
        clientSourceUnit: "M1",
        requiredQuotes: 1,
      },
    })
  ).id;
  await assignResearchers(em, studyId, country, [author.userId]);
  return id;
}

/** Drive one quote on `item` to Approved so its Country becomes release-eligible
 *  (requiredQuotes 1, no in-flight). Pins USD figures to clear the conversion gate. */
async function approveQuoteOn(item: string): Promise<void> {
  const id = await makeLine(item);
  const line = await prisma.quoteLine.findUniqueOrThrow({ where: { id }, select: { marketQuoteId: true } });
  await submitMarketQuote(author, line.marketQuoteId);
  await prisma.marketQuote.update({
    where: { id: line.marketQuoteId },
    data: { conversionStatus: "auto", exchangeRate: "1.00000000", rateDate: new Date("2026-06-01") },
  });
  await prisma.quoteLine.update({
    where: { id },
    data: { convertedUsdPrice: "100.0000", convertedUsdPricePerUnit: "100.0000" },
  });
  await approveLine(analyst, id);
}

/** send_notification_email jobs enqueued for the given notification ids. */
async function emailJobsFor(notificationIds: string[]): Promise<number> {
  if (notificationIds.length === 0) return 0;
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*)::bigint as n
       from graphile_worker._private_jobs j
       join graphile_worker._private_tasks t on t.id = j.task_id
      where t.identifier = 'send_notification_email'
        and j.payload->>'notificationId' = any($1::text[])`,
    notificationIds,
  );
  return Number(rows[0].n);
}

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: "Tenant (notif test)" } });
  tenantId = client.id;

  const emId = await seedUser("internal", { role: "EngagementManager" });
  em = { kind: "internal", userId: emId, role: "EngagementManager" };
  const analystId = await seedUser("internal", { role: "Analyst" });
  analyst = { kind: "internal", userId: analystId, role: "Analyst" };
  const authorId = await seedUser("internal", { role: "Researcher" });
  author = { kind: "internal", userId: authorId, role: "Researcher" };
  deactivatedUserId = await seedUser("internal", { role: "Researcher", status: "deactivated" });
  clientUser1 = await seedUser("client", { tenantId });
  clientUser2 = await seedUser("client", { tenantId });
  clientUserOff = await seedUser("client", { tenantId, status: "deactivated" });

  studyId = (await createStudy(em, { name: "Notif study", clientId: tenantId, qcThreshold: 0.25 })).id;
  itemId = (
    await prisma.benchmarkItem.create({
      data: {
        studyId,
        clientId: tenantId,
        country: "Germany",
        clientItemNumber: "PN-1",
        clientItemNumberKey: "pn-1",
        itemDescription: "Hydraulic widget",
        clientSourceUnit: "M1",
        requiredQuotes: 1,
      },
    })
  ).id;
  await assignResearchers(em, studyId, "Germany", [author.userId]);
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { studyId } });
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { studyId } });
  await prisma.auditEvent.deleteMany({ where: { studyId } });
  await prisma.quoteLine.deleteMany({ where: { studyId } });
  await prisma.marketQuote.deleteMany({ where: { studyId } });
  await prisma.quoteNumberSequence.deleteMany({ where: { studyId } });
  await prisma.countryRelease.deleteMany({ where: { studyId } });
  await prisma.countryAssignment.deleteMany({ where: { studyId } });
  await prisma.benchmarkItem.deleteMany({ where: { studyId } });
  await prisma.study.deleteMany({ where: { clientId: tenantId } });
  await prisma.user.deleteMany({
    where: {
      OR: [{ tenantId }, { id: em.userId }, { id: analyst.userId }, { id: author.userId }, { id: deactivatedUserId }],
    },
  });
  await prisma.client.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("rejection notifies the quote's author", () => {
  it("writes an in-app notification to the author with the reason, and enqueues an email", async () => {
    const quoteId = await submittedQuote();

    const result = await rejectLine(analyst, quoteId, "Price higher than expected");
    expect(result.ok).toBe(true);

    const notes = await prisma.notification.findMany({ where: { studyId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      recipientId: author.userId,
      kind: "quoteRejected",
      subjectType: "QuoteLine",
      subjectId: quoteId,
      reason: "Price higher than expected",
      country: null,
      readAt: null,
      emailedAt: null,
    });

    expect(await emailJobsFor(notes.map((n) => n.id))).toBe(1);
  });

  it("skips a deactivated (offboarded) author entirely — no in-app row, no email", async () => {
    const quoteId = await submittedQuote();
    // The author left the company between submitting and the analyst's verdict.
    await prisma.quoteLine.update({ where: { id: quoteId }, data: { createdById: deactivatedUserId } });

    const result = await rejectLine(analyst, quoteId, "Out of date");
    expect(result.ok).toBe(true);

    expect(await prisma.notification.count({ where: { studyId } })).toBe(0);
  });
});

describe("country release notifies the tenant's active Client Users", () => {
  it("on first release, notifies every active Client User (only), snapshots the country, and enqueues emails", async () => {
    const item = await seedCountry("France");
    await approveQuoteOn(item);

    await releaseCountry(analyst, studyId, "France");

    const notes = await prisma.notification.findMany({ where: { studyId } });
    expect(notes.map((n) => n.recipientId).sort()).toEqual([clientUser1, clientUser2].sort());
    for (const n of notes) {
      expect(n).toMatchObject({
        kind: "countryReleased",
        subjectType: "CountryRelease",
        country: "France",
        reason: null,
        readAt: null,
      });
    }
    // The deactivated Client User is never a recipient.
    expect(notes.map((n) => n.recipientId)).not.toContain(clientUserOff);

    // The first-release marker is stamped, and one email job per recipient.
    const row = await prisma.countryRelease.findUnique({
      where: { studyId_country: { studyId, country: "France" } },
      select: { clientNotifiedAt: true },
    });
    expect(row?.clientNotifiedAt).not.toBeNull();
    expect(await emailJobsFor(notes.map((n) => n.id))).toBe(2);
  });

  it("does NOT re-notify on re-release after a reopen (clientNotifiedAt survives)", async () => {
    const item = await seedCountry("Spain");
    await approveQuoteOn(item);

    await releaseCountry(analyst, studyId, "Spain"); // first release → notifies
    await prisma.notification.deleteMany({ where: { studyId } }); // isolate the re-release

    await reopenCountry(analyst, studyId, "Spain");
    await releaseCountry(analyst, studyId, "Spain"); // re-release → silent

    expect(await prisma.notification.count({ where: { studyId } })).toBe(0);
  });
});

describe("the in-app inbox", () => {
  it("lists the recipient's own notifications newest-first, with an unread count", async () => {
    const q1 = await submittedQuote();
    await rejectLine(analyst, q1, "First reason");
    const q2 = await submittedQuote();
    await rejectLine(analyst, q2, "Second reason");

    const inbox = await listNotifications(author);
    expect(inbox.map((n) => n.subjectId)).toEqual([q2, q1]); // newest first
    expect(inbox[0]).toMatchObject({ kind: "quoteRejected", reason: "Second reason", readAt: null });
    expect(await unreadCount(author)).toBe(2);
  });

  it("markAllRead clears the caller's unread only, never another user's", async () => {
    const cu1: ClientPrincipal = { kind: "client", userId: clientUser1, tenantId };
    const q = await submittedQuote();
    await rejectLine(analyst, q, "Reason"); // author gets one
    const item = await seedCountry("Italy");
    await approveQuoteOn(item);
    await releaseCountry(analyst, studyId, "Italy"); // clientUser1 + clientUser2 each get one

    await markAllRead(author);

    expect(await unreadCount(author)).toBe(0);
    const authorInbox = await listNotifications(author);
    expect(authorInbox.every((n) => n.readAt !== null)).toBe(true);
    // The client user's notification is untouched.
    expect(await unreadCount(cu1)).toBe(1);
  });
});

describe("the email worker step (sendNotificationEmail)", () => {
  it("delivers a notification to its recipient and stamps emailedAt", async () => {
    vi.mocked(sendEmail).mockClear();
    const q = await submittedQuote();
    await rejectLine(analyst, q, "Reason X");
    const note = await prisma.notification.findFirstOrThrow({ where: { subjectId: q } });

    await sendNotificationEmail(note.id);

    expect(sendEmail).toHaveBeenCalledOnce();
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.to).toContain(author.userId); // seeded email embeds the user id
    expect(email.subject).toBe("Your quote was rejected");
    expect(email.body).toContain("Reason X");

    const refreshed = await prisma.notification.findUniqueOrThrow({ where: { id: note.id } });
    expect(refreshed.emailedAt).not.toBeNull();
  });

  it("is a no-op for an already-emailed notification (at-least-once dedupe)", async () => {
    vi.mocked(sendEmail).mockClear();
    const q = await submittedQuote();
    await rejectLine(analyst, q, "Reason Y");
    const note = await prisma.notification.findFirstOrThrow({ where: { subjectId: q } });
    await prisma.notification.update({ where: { id: note.id }, data: { emailedAt: new Date() } });

    await sendNotificationEmail(note.id);

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("is a no-op for a missing notification (a stale job must not poison the queue)", async () => {
    vi.mocked(sendEmail).mockClear();
    await expect(sendNotificationEmail("does-not-exist")).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
