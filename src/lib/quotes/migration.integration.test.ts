import { execSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Faithful proof of the #87 data migration (ADR-0026) on NON-empty data: each flat
// `quote` becomes a one-line Market Quote with its id PRESERVED (so audit history
// still resolves), numbers backfilled deterministically by (createdAt, id), and the
// legacy free-text folded into the secondary note. The pure numbering/folding spec
// is unit-tested in src/domains/quotes/numbering; this runs the REAL migration SQL.
//
// Setup builds a throwaway second database, deploys every migration EXCEPT the
// split (a temp copy of prisma/ with the split removed), seeds flat quotes, then
// applies the split migration.sql statement-by-statement and asserts the result.

const SPLIT = "20260622000000_market_quote_split";
const adminUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
const dbName = `qf_migr_${Date.now()}`;
const migrUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

let admin: PrismaClient;
let db: PrismaClient;
// Two flat quotes in one (study, country), created out of chronological order so
// the deterministic (createdAt, id) numbering is observable.
const olderId = "line-older-aaaaaaaaaaaaaaaaaaaa";
const newerId = "line-newer-zzzzzzzzzzzzzzzzzzzz";

beforeAll(async () => {
  admin = new PrismaClient();
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);

  // Temp copy of prisma/ deployed up to (but not including) the split → "pre-split".
  // Remove the split AND every later migration (e.g. #108 dealer-location, which
  // ALTERs market_quote): those depend on tables the split creates, so deploying
  // them against a pre-split DB would fail. Migration dirs are timestamp-prefixed,
  // so a lexical compare drops everything from the split onward.
  const tmp = join(tmpdir(), `qf-prisma-${Date.now()}`);
  cpSync(join(process.cwd(), "prisma"), tmp, { recursive: true });
  for (const name of readdirSync(join(tmp, "migrations"))) {
    if (name >= SPLIT && name !== "migration_lock.toml") {
      rmSync(join(tmp, "migrations", name), { recursive: true, force: true });
    }
  }
  execSync(`npx prisma migrate deploy --schema "${join(tmp, "schema.prisma")}"`, {
    env: { ...process.env, DATABASE_URL: migrUrl, DIRECT_URL: migrUrl },
    stdio: "ignore",
  });

  db = new PrismaClient({ datasources: { db: { url: migrUrl } } });

  // Seed a pre-split fixture (client → study → item → two flat quotes) via raw SQL
  // (the pre-split `quote` table shape).
  const cid = "client-x", sid = "study-x", iid = "item-x", uid = "user-x";
  await db.$executeRawUnsafe(`INSERT INTO "client"(id,name,"createdAt","updatedAt") VALUES('${cid}','C',now(),now())`);
  await db.$executeRawUnsafe(`INSERT INTO "user"(id,name,email,"emailVerified",kind,role,status,"createdAt","updatedAt") VALUES('${uid}','U','u@x.test',true,'internal','Researcher','active',now(),now())`);
  await db.$executeRawUnsafe(`INSERT INTO "study"(id,name,"clientId","createdById","qcThreshold","createdAt","updatedAt") VALUES('${sid}','S','${cid}','${uid}',0.25,now(),now())`);
  await db.$executeRawUnsafe(`INSERT INTO "benchmark_item"(id,"studyId","clientId",country,"clientItemNumber","clientItemNumberKey","itemDescription","requiredQuotes","createdAt","updatedAt","requiredCompetitors") VALUES('${iid}','${sid}','${cid}','Germany','PN1','pn1','desc',2,now(),now(),ARRAY[]::text[])`);
  // newer row inserted first, but with a LATER createdAt → must number 2.
  await db.$executeRawUnsafe(`INSERT INTO "quote"(id,"benchmarkItemId","clientId","quoteNumber",state,"createdById","competitorBrand","dealerName",price,currency,"quantityQuoted","leadTime",warranty,notes,"createdAt","updatedAt") VALUES('${newerId}','${iid}','${cid}',2,'Approved','${uid}','Cat','DealerN',100,'EUR',1,'2 wk','1 yr','keep me','2026-02-02','2026-02-02')`);
  await db.$executeRawUnsafe(`INSERT INTO "quote"(id,"benchmarkItemId","clientId","quoteNumber",state,"createdById","competitorBrand","dealerName",price,currency,"quantityQuoted",notes,"createdAt","updatedAt") VALUES('${olderId}','${iid}','${cid}',1,'Approved','${uid}','Cat','DealerO',200,'EUR',1,NULL,'2026-01-01','2026-01-01')`);

  // Apply the REAL split migration, statement by statement (each its own implicit
  // transaction, so ALTER TYPE ADD VALUE commits before any later use).
  const sql = readFileSync(join(process.cwd(), "prisma", "migrations", SPLIT, "migration.sql"), "utf8");
  for (const stmt of sql.split(/;[ \t]*\r?\n/)) {
    const trimmed = stmt.trim();
    if (trimmed === "" || trimmed.startsWith("--")) {
      // Drop leading comment lines but keep an embedded statement after them.
      const code = trimmed.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
      if (code === "") continue;
      await db.$executeRawUnsafe(code);
      continue;
    }
    await db.$executeRawUnsafe(trimmed);
  }
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.$disconnect();
});

describe("#87 data migration on existing flat quotes", () => {
  it("turns each flat quote into a one-line Market Quote (no merging)", async () => {
    const docs = await db.marketQuote.count({ where: { studyId: "study-x" } });
    const lines = await db.quoteLine.count({ where: { studyId: "study-x" } });
    expect(docs).toBe(2);
    expect(lines).toBe(2);
  });

  it("preserves each line's id (audit/notification subjectIds stay resolvable)", async () => {
    const ids = (await db.quoteLine.findMany({ where: { studyId: "study-x" }, select: { id: true } })).map((l) => l.id);
    expect(ids.sort()).toEqual([olderId, newerId].sort());
  });

  it("numbers deterministically by (createdAt, id): older → 1, newer → 2", async () => {
    const older = await db.quoteLine.findUniqueOrThrow({ where: { id: olderId }, select: { quoteLineNumber: true } });
    const newer = await db.quoteLine.findUniqueOrThrow({ where: { id: newerId }, select: { quoteLineNumber: true } });
    expect(older.quoteLineNumber).toBe(1);
    expect(newer.quoteLineNumber).toBe(2);
  });

  it("lifts document facts up and keeps the primary note 1:1", async () => {
    const line = await db.quoteLine.findUniqueOrThrow({
      where: { id: newerId },
      select: { notes: true, marketQuote: { select: { sourceName: true, currency: true } } },
    });
    expect(line.marketQuote.sourceName).toBe("DealerN");
    expect(line.marketQuote.currency).toBe("EUR");
    expect(line.notes).toBe("keep me");
  });

  it("folds legacy lead-time/warranty/discount into the secondary note", async () => {
    const withText = await db.quoteLine.findUniqueOrThrow({ where: { id: newerId }, select: { notesSecondary: true } });
    expect(withText.notesSecondary).toBe("Lead time: 2 wk; Warranty: 1 yr");
    const noText = await db.quoteLine.findUniqueOrThrow({ where: { id: olderId }, select: { notesSecondary: true } });
    expect(noText.notesSecondary).toBeNull();
  });

  it("seeds the sequence row to the highest number allocated", async () => {
    const seq = await db.quoteNumberSequence.findFirstOrThrow({ where: { studyId: "study-x", country: "Germany" } });
    expect(seq.marketQuoteSeq).toBe(2);
    expect(seq.quoteLineSeq).toBe(2);
  });
});
