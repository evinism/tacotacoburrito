import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { GoogleAnalytics } from "@next/third-parties/google";

import Providers from "./providers";
import styles from "./layout.module.css";
import "./globals.css";

export const metadata: Metadata = {
  // `default` is used when a page doesn't set its own title; `template` wraps
  // any page-level title (e.g. a "Notation" page renders "Notation · 🌮🌮🌯").
  title: {
    default: "🌮🌮🌯",
    template: "%s · 🌮🌮🌯",
  },
  description: "A simple metronome for not-so-simple times",
  metadataBase: new URL("https://tacotacoburrito.com"),
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
        <AppRouterCacheProvider>
          <Providers>
            <div className={styles.App}>
              <div className={styles.Background} />
              {children}
            </div>
          </Providers>
        </AppRouterCacheProvider>
      </body>
      <GoogleAnalytics gaId="G-BE7JKJMJHN" />
    </html>
  );
}
