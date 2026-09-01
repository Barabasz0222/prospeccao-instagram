import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "BraszTech · Prospecção no Instagram",
  description: "Painel de prospecção comercial autônoma",
};

const NAV = [
  { href: "/", label: "Painel" },
  { href: "/leads", label: "Leads" },
  { href: "/conversas", label: "Conversas" },
  { href: "/experimentos", label: "Experimentos" },
  { href: "/excecoes", label: "Exceções" },
  { href: "/configuracoes", label: "Configurações" },
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800">
            <div className="mb-6 text-sm font-semibold">BraszTech · Prospecção</div>
            <nav className="flex flex-col gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
