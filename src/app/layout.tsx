import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import "./globals.css";

export const metadata: Metadata = {
  title: "🌮🌮🌯",
  description: "A simple metronome for not-so-simple times",
  openGraph: {
    url: "https://tacotacoburrito.com",
    type: "website",
    title: "TacoTacoBurrito",
    description: "A simple metronome for not-so-simple times",
    images: ["/metronome.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>{children}</AppRouterCacheProvider>
      </body>
    </html>
  );
}
