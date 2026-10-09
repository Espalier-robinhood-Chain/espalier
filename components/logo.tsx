import Image from "next/image";

// Varian logo mengikuti tema: tinta gelap untuk tema terang, krem untuk tema gelap.
// Aturan CSS ikut di komponen ini supaya tidak bergantung pada globals.css; React men-dedupe <style href>.
const css = `
.logo-for-dark{display:none!important}
.logo-for-light{display:inline-block!important}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]) .logo-for-light{display:none!important}
  :root:not([data-theme="light"]) .logo-for-dark{display:inline-block!important}
}
:root[data-theme="dark"] .logo-for-light{display:none!important}
:root[data-theme="dark"] .logo-for-dark{display:inline-block!important}
:root[data-theme="light"] .logo-for-dark{display:none!important}
:root[data-theme="light"] .logo-for-light{display:inline-block!important}
`;

export function Logo({ className = "size-7", priority = false }: { className?: string; priority?: boolean }) {
  return (
    <>
      <style href="logo-theme" precedence="default">{css}</style>
      <Image src="/logo-mark-dark.png" alt="" width={64} height={64} priority={priority} aria-hidden className={`logo-for-light shrink-0 ${className}`} />
      <Image src="/logo-mark.png" alt="" width={64} height={64} priority={priority} aria-hidden className={`logo-for-dark shrink-0 ${className}`} />
    </>
  );
}
