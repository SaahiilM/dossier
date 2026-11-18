import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { basicsFromFields, fieldsFromBasics, type Basics } from "@/lib/profile";

export const profileBasicsSchema = z.object({
  name: z.string().max(200),
  headline: z.string().max(300),
  email: z.string().max(320),
  phone: z.string().max(60),
  dob: z.union([z.literal(""), z.iso.date()]),
  website: z.string().max(500),
  address: z.string().max(300),
  city: z.string().max(120),
  country: z.string().max(120),
  linkedin: z.string().max(500),
  summary: z.string().max(5000),
  showAge: z.boolean(),
});

export async function writeProfileBasics(basics: Basics): Promise<void> {
  await writeFields(Object.entries(fieldsFromBasics(basics)));
}

export async function readProfileBasics(): Promise<Basics> {
  return basicsFromFields(await prisma.profileField.findMany());
}

export async function patchProfileBasics(patch: Partial<Basics>): Promise<Basics> {
  const fields = Object.entries(patch).map(([key, value]): [string, string | null] => [
    key, typeof value === "boolean" ? (value ? "true" : null) : value || null,
  ]);
  await writeFields(fields);
  return readProfileBasics();
}

async function writeFields(fields: [string, string | null][]): Promise<void> {
  await prisma.$transaction(
    fields.map(([key, value]) =>
      value === null
        ? prisma.profileField.deleteMany({ where: { key } })
        : prisma.profileField.upsert({ where: { key }, create: { key, value }, update: { value } }),
    ),
  );
}
