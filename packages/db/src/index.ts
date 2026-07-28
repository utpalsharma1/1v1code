import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export {
  PROBLEMS,
  assertSeedIntegrity,
  type SeedProblem,
  type SeedTest,
  type SeedTopic,
} from "./problems";
export {
  REGISTRY,
  VALIDATOR_KEYS,
  getValidator,
  type ValidationResult,
  type Validator,
} from "./validators";

// Next's dev server hot-reloads modules, which would otherwise open a new pool
// on every edit until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env["NODE_ENV"] !== "production") globalForPrisma.prisma = prisma;
