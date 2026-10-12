import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Toaster } from "sonner";
import { APP_NAME, LOGO_PATH } from "@/lib/brand";

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} - quizzes and attendance`,
  icons: { icon: LOGO_PATH, shortcut: LOGO_PATH, apple: LOGO_PATH },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full overflow-hidden">
      <body className="h-full overflow-hidden antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
