import type { Metadata } from "next";
import "./globals.css";
import "./forms.css";
export const metadata: Metadata = {
  title: "Despachos · Tu cierre diario",
  description: "Control de despachos y liquidaciones a tu proveedor",
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
