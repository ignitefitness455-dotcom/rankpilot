import { z } from "zod";

export const syncGscRequestSchema = z.object({
  days: z.coerce.number().int().min(14).max(90).optional().default(56),
});

export const connectGoogleQuerySchema = z.object({
  projectId: z.uuid(),
});
