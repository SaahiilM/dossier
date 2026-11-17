"use client";

import { ScreenError, type ErrorPageProps } from "@/components/screen-error";

export default function CapturesError(props: ErrorPageProps) {
  return (
    <ScreenError {...props} title="Your Capture Inbox didn't load" elsewhere={{ href: "/captures", label: "Open Capture Inbox" }}>
      <p>The saved Inbox may be temporarily unavailable. Your captures have not been changed.</p>
    </ScreenError>
  );
}
