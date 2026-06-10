import { NavHeader } from "./NavHeader";

export const metadata = {
  title: "QuoteFlow",
  description: "Multi-tenant pricing-study platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <NavHeader />
        {children}
      </body>
    </html>
  );
}
