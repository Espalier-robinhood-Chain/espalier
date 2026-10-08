'use client';
import { useEffect, useState } from 'react';

// Daftar isi sidebar Docs: menandai bagian yang sedang dibaca (scrollspy) dan menampilkannya di bagian atas.
type Group = { label: string; items: readonly (readonly [string, string])[] };

export function DocsNav({ groups }: { groups: readonly Group[] }) {
  const all = groups.flatMap((g) =>
    g.items.map(([id, label]) => ({ id, label, group: g.label })),
  );
  const [active, setActive] = useState(all[0].id);

  useEffect(() => {
    const els = all
      .map((a) => document.getElementById(a.id))
      .filter((e): e is HTMLElement => !!e);
    const pick = () => {
      // Bagian aktif = yang judulnya terakhir melewati garis ~30% dari atas layar; di dasar halaman, bagian terakhir.
      const line = window.innerHeight * 0.3;
      let cur = els[0]?.id ?? all[0].id;
      for (const el of els)
        if (el.getBoundingClientRect().top <= line) cur = el.id;
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4
      )
        cur = els[els.length - 1].id;
      setActive(cur);
    };
    pick();
    window.addEventListener('scroll', pick, { passive: true });
    window.addEventListener('resize', pick);
    return () => {
      window.removeEventListener('scroll', pick);
      window.removeEventListener('resize', pick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const idx = all.findIndex((a) => a.id === active);
  const cur = all[idx];

  return (
    <nav
      aria-label="On this page"
      className="max-md:sticky max-md:top-14 max-md:z-10 max-md:-mx-5 max-md:border-b max-md:border-wire max-md:bg-wall/90 max-md:px-5 max-md:py-2 max-md:backdrop-blur md:sticky md:top-20 md:self-start"
    >
      <p
        aria-live="polite"
        className="mb-4 rounded-[14px] bg-panel px-3.5 py-2.5 max-md:mb-0 max-md:rounded-full max-md:py-1.5"
      >
        <span className="block font-mono text-[.72rem] tracking-wide text-bark uppercase">
          You are here · {idx + 1}/{all.length}
        </span>
        <span className="block font-display text-[1.05rem] leading-tight max-md:text-base">
          {cur.label}
        </span>
      </p>
      <div className="grid gap-x-6 gap-y-5 max-md:hidden md:gap-y-8">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-2.5 px-1 font-mono text-[.78rem] tracking-wide text-bark uppercase">
              {g.label}
            </p>
            <ul className="space-y-1.5">
              {g.items.map(([id, label]) => {
                const on = id === active;
                return (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      aria-current={on ? 'location' : undefined}
                      className={`flex min-h-11 w-full items-center rounded-lg px-4 py-2 text-[.95rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf ${on ? 'bg-leaf font-medium text-on-leaf' : 'text-bark hover:bg-panel-2 hover:text-ink'}`}
                    >
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
