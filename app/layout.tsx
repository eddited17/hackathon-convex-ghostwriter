import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

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
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
