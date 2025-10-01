import { cronJobs } from "convex/server";

import { api } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "processDraftQueue",
  { seconds: 30 },
  api.documents.processDraftQueueBatch,
  { limit: 3 },
);

crons.cron(
  "verifyTranscriptIntegrity",
  "0 4 * * *",
  api.projects.verifyTranscriptIntegrity,
  {},
);

export default crons;
