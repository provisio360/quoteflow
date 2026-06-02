import "dotenv/config";
import { runOnce, makeWorkerUtils } from "graphile-worker";
import healthPing from "./tasks/health-ping";

// Smoke test: install graphile-worker's schema, enqueue one job, process the
// queue once, then exit. Proves the queue works end-to-end without a long-lived
// process. Run with `npm run worker:once`.
async function main() {
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is not set");

  const utils = await makeWorkerUtils({ connectionString });
  await utils.migrate();
  await utils.addJob("health_ping", { note: "skeleton smoke test" });
  await utils.release();

  await runOnce({
    connectionString,
    taskList: { health_ping: healthPing },
  });

  console.log("worker:once completed — one job enqueued and processed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
