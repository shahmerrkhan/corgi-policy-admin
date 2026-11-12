import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Policy Admin",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
