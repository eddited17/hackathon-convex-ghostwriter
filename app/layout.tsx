import type { Metadata } from "next";
import "./globals.css";
import { ConvexClientProvider } from "../lib/convex-client-provider";

export const metadata: Metadata = {
  title: "AI Ghostwriter",
  description: "Realtime ghostwriter workspace powered by OpenAI and Convex"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
