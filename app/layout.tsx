import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

import { AppProviders } from "./AppProviders";

export const metadata: Metadata = {
  title: "AI Ghostwriter",
  description: "Realtime ghostwriter workspace powered by OpenAI and Convex",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="app-body">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
