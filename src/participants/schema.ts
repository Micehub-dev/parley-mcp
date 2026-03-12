import { z } from "zod";

export const participantStanceSchema = z.enum(["agree", "disagree", "refine", "undecided"]);

export const participantResponseSchema = z
  .object({
    stance: participantStanceSchema,
    summary: z.string().min(1),
    arguments: z.array(z.string().min(1)),
    questions: z.array(z.string().min(1)),
    proposed_next_step: z.string().min(1)
  })
  .strict();

export const participantResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    stance: {
      type: "string",
      enum: ["agree", "disagree", "refine", "undecided"]
    },
    summary: {
      type: "string"
    },
    arguments: {
      type: "array",
      items: {
        type: "string"
      }
    },
    questions: {
      type: "array",
      items: {
        type: "string"
      }
    },
    proposed_next_step: {
      type: "string"
    }
  },
  required: ["stance", "summary", "arguments", "questions", "proposed_next_step"]
} as const;
