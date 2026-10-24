import { z } from "zod";

/** Facts quoted from a supplier message. A null quantity/date means unconfirmed. */
export const SupplierExtractionSchema = z.object({
  items: z.array(z.object({
    productName: z.string().min(1).max(100),
    aliases: z.array(z.string().max(100)).max(8),
    quantity: z.number().finite().nonnegative().nullable(),
    unit: z.string().max(30).nullable(),
    availability: z.enum(["available", "unavailable", "unknown"]),
    confirmed: z.boolean(),
    ambiguous: z.boolean(),
    evidence: z.array(z.string().min(1).max(300)).max(5),
  }).strict()).max(30),
  deliveryDates: z.array(z.object({
    dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }).nullable(),
    confirmed: z.boolean(),
    ambiguous: z.boolean(),
    evidence: z.array(z.string().min(1).max(300)).max(5),
  }).strict()).max(20),
  missingDetails: z.array(z.string().max(200)).max(30),
}).strict();

export type SupplierExtraction = z.infer<typeof SupplierExtractionSchema>;

export const AnalyzeSupplierMessageRequestSchema = z.object({
  message: z.string().trim().min(1).max(5000),
}).strict();

