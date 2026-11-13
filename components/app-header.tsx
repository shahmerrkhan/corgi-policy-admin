import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

type AppHeaderProps = {
  area: string;
  who: string;
  links: { href: string; label: string }[];
};

export function AppHeader({ area, who, links }: AppHeaderProps) {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-base font-semibold">
            Policy Admin <span className="font-normal text-muted-foreground">· {area}</span>
          </span>
          <nav className="flex flex-wrap gap-3 text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-accent underline-offset-2 hover:underline">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{who}</span>
          <SignOutButton redirectUrl="/sign-in">
            <Button size="sm" variant="secondary">
              Sign out
            </Button>
          </SignOutButton>
        </div>
      </div>
    </header>
  );
}
