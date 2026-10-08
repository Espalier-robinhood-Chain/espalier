'use client';
import { useEffect, useRef } from 'react';

// Pembungkus "tumbuh saat terlihat" (data-grow di espalier.html). Menambah kelas `grown` sekali, saat elemen masuk viewport.
// CSS di globals.css hanya menyembunyikan isi (.draw, .fruit, .fade, ...) bila <html> punya kelas `js` dan pengguna
// tidak meminta reduced motion, jadi tanpa JS atau dengan reduced motion isi langsung tampil utuh.
type Tag = 'div' | 'section' | 'ul' | 'ol' | 'li';
export function Reveal({
  as = 'div',
  className,
  children,
  ...rest
}: {
  as?: Tag;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('grown');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add('grown');
            io.unobserve(e.target);
          }
      },
      { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const El = as as React.ElementType;
  return (
    <El ref={ref} data-grow className={className} {...rest}>
      {children}
    </El>
  );
}
