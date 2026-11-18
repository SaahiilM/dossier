import "server-only";

import { z } from "zod";

import { profileIdOr } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";
import { basicsFromFields, type Basics } from "@/lib/profile";

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

export async function writeProfileBasics(basics: Basics, profileId: string): Promise<void> {
  await patchProfileBasics(basics, profileId);
}

export async function readProfileBasics(profileId?: string): Promise<Basics> {
  const id = await profileIdOr(profileId);
  const [fields, profile] = await Promise.all([
    prisma.profileField.findMany(),
    prisma.profile.findUniqueOrThrow({ where: { id }, select: { headline: true, summary: true } }),
  ]);
  return { ...basicsFromFields(fields), ...profile };
}

export async function patchProfileBasics(patch: Partial<Basics>, profileId?: string): Promise<Basics> {
  const id = await profileIdOr(profileId);
  const { headline, summary, ...shared } = patch;
  const fields = Object.entries(shared).map(([key, value]): [string, string | null] => [
    key, typeof value === "boolean" ? (value ? "true" : null) : value || null,
  ]);
  await prisma.$transaction([
    ...fields.map(([key, value]) =>
      value === null
        ? prisma.profileField.deleteMany({ where: { key } })
        : prisma.profileField.upsert({ where: { key }, create: { key, value }, update: { value } }),
    ),
    ...(headline !== undefined || summary !== undefined
      ? [prisma.profile.update({ where: { id }, data: { headline, summary } })]
      : []),
  ]);
  return readProfileBasics(id);
}
