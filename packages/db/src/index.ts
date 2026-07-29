import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export {
  PROBLEMS,
  assertSeedIntegrity,
  type SeedProblem,
  type SeedTest,
  type SeedTopic,
  // Explicit extensions throughout: these modules are consumed both by Next's
  // bundler and by bare Node (seed + verify scripts), and only one of those two
  // resolves an extensionless specifier.
} from "./problems.ts";
export {
  REGISTRY,
  VALIDATOR_KEYS,
  getValidator,
  type ValidationResult,
  type Validator,
} from "./validators.ts";
// The bot submits these through the real judge (§8), so the gateway needs them.
export { SOLUTIONS, SOLVED_SLUGS, solutionFor } from "./solutions.ts";

// Next's dev server hot-reloads modules, which would otherwise open a new pool
// on every edit until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") globalForPrisma.prisma = prisma;
