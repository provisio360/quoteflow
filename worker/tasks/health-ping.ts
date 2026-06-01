import type { Task } from "graphile-worker";

// Trivial background task for the walking skeleton. Real tasks (pending-FX fill,
// notifications, exports) arrive with their slices.
const healthPing: Task = async (payload, helpers) => {
  helpers.logger.info(`health_ping ran with payload: ${JSON.stringify(payload)}`);
};

export default healthPing;
