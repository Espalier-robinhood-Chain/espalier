// Template dipasang ulang di setiap navigasi, sehingga `main` baru memutar animasi masuk halaman (.view di espalier.html).
export default function Template({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
