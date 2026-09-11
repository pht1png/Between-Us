import { z } from "zod";

import { SECTION_IDS } from "@/lib/sections";

export const loginSchema = z.object({
  password: z.string().min(1),
});

export const sectionIdSchema = z.enum(SECTION_IDS);

export const createRoomSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  questions: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        duration: z.number().int().min(5).max(120),
        section: sectionIdSchema,
      }),
    )
    .min(1)
    // Every section must be represented: matching compares participants section by section, so a
    // room missing a section silently drops that dimension for everyone in it.
    .refine((questions) => SECTION_IDS.every((id) => questions.some((q) => q.section === id)), {
      message: "ต้องมีคำถามอย่างน้อย 1 ข้อในทุกหมวด",
    }),
});

const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;
const MAX_PHOTO_DATA_URL_LENGTH = 400_000; // generous over compress-image's ~30KB target (base64 inflates ~1.37x)

export const sexSchema = z.enum(["male", "female"]);

export const joinSchema = z.object({
  name: z.string().trim().min(1).max(24),
  bio: z.string().trim().min(1).max(140),
  sex: sexSchema,
  photo: z
    .string()
    .max(MAX_PHOTO_DATA_URL_LENGTH)
    .regex(PHOTO_DATA_URL)
    .nullable(),
});

export const answerSchema = z.object({
  questionIndex: z.number().int().min(0),
  value: z.number().int().min(1).max(10),
});
