import { z } from "zod";

import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { Extracted, Match } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

export const mobileLoginRequestSchema = z.object({
  password: z.string().min(1).max(4_096),
  deviceName: z.string().trim().min(1).max(80).optional(),
}).strict();

export type MobileLoginRequest = z.infer<typeof mobileLoginRequestSchema>;

export type MobileApplicationSummary = {
  id: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  status: ApplicationStatus;
  archived: boolean;
  match: { hit: number; total: number } | null;
  score: number | null;
  updatedAt: string;
};

export type MobileApplicationNote = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type MobileApplication = {
  id: string;
  title: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  salary: string;
  status: ApplicationStatus;
  archived: boolean;
  deadline: string | null;
  postingUrl: string;
  postingText: string;
  language: string;
  sentAt: string | null;
  nextInterviewAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: MobileApplicationNote[];
  extracted: Extracted;
  match: Match | null;
};

export type MobileProfile = ProfileData;

/** Boolean setup status only; provider details and persisted setup data stay private. */
export type MobileSetup = {
  profileReady: boolean;
  aiConfigured: boolean;
  setupInProgress: boolean;
};
