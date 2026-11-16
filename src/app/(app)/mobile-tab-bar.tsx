"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV, isCurrent } from "@/lib/nav";
import { cn } from "@/lib/cn";

const dashboard = NAV[0]!.items[0]!;
const agent = NAV[2]!.items.find((item) => item.href === "/agent")!;
const applications = NAV[2]!.items.find((item) => item.href === "/applications")!;

/** A compact route into the three phone-first screens plus a fresh application. */
export function MobileTabBar({ agentCount }: { agentCount: number }) {
  const pathname = usePathname();
  const tabs = [
    { href: dashboard.href, label: "Home", icon: dashboard.icon, active: isCurrent(dashboard, pathname) },
    { href: applications.href, label: "Applications", icon: applications.icon, active: isCurrent(applications, pathname) && pathname !== "/new" },
    { href: "/new?fresh=1", label: "New", icon: Plus, active: false },
    { href: agent.href, label: "Agent", icon: agent.icon, active: isCurrent(agent, pathname), count: agentCount },
  ];

  return (
    <nav aria-label="Quick navigation" className="mobile-tab-bar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-2 pt-1.5 backdrop-blur md:hidden">
      <ul className="mx-auto flex max-w-lg items-stretch justify-around gap-1">
        {tabs.map(({ href, label, icon: Icon, active, count = 0 }) => (
          <li key={label} className="min-w-0 flex-1">
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-[10px] font-medium",
                active ? "text-ink" : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2.25 : 1.8} aria-hidden="true" />
              <span className="truncate">{label}</span>
              {count > 0 && (
                <span className="absolute top-0.5 left-[calc(50%+7px)] min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-on-primary">
                  {count > 99 ? "99+" : count}
                  <span className="sr-only"> agent items waiting</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
