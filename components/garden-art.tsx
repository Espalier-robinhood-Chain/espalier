// Ilustrasi garis satu warna (currentColor = --bark), stroke 1–1.5px, untuk halaman sistem.
// Dekoratif: aria-hidden. Statis, tanpa animasi, jadi tidak ada urusan reduced motion.
// "bare": cabang tanpa buah; lingkaran putus-putus menandai buah yang tidak ada (404).
// "cut": cabang patah dengan satu daun jatuh (error).
export function GardenArt({ variant, className = "" }: { variant: "bare" | "cut"; className?: string }) {
  const spurs = [96, 150, 204] as const;
  return (
    <svg aria-hidden viewBox="0 0 320 150" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={`mx-auto h-auto w-full max-w-xs text-bark ${className}`}>
      {/* kawat trellis */}
      <g strokeWidth="1" opacity="0.4">
        <path d="M8 36H312M8 80H312M8 124H312" />
      </g>
      {/* batang */}
      <path d="M40 146V18" strokeWidth="1.5" />
      <path d="M34 146H46" strokeWidth="1" />
      {variant === "bare" ? (
        <>
          <path d="M40 80H262" strokeWidth="1.5" />
          {spurs.map((x) => (
            <g key={x} strokeWidth="1">
              <path d={`M${x} 80v-16`} />
              <circle cx={x} cy="60" r="3" />
              <path d={`M${x + 22} 80v14`} />
              <circle cx={x + 22} cy="98" r="3" />
            </g>
          ))}
          <circle cx="282" cy="80" r="11" strokeWidth="1" strokeDasharray="3 4" />
        </>
      ) : (
        <>
          <path d="M40 80H168" strokeWidth="1.5" />
          <path d="M96 80v-16" strokeWidth="1" />
          <circle cx="96" cy="60" r="3" strokeWidth="1" />
          <path d="M163 73l10 14" strokeWidth="1.5" />
          {/* bagian yang jatuh */}
          <path d="M214 124l62-12" strokeWidth="1.5" />
          <path d="M240 119l4-12M258 116l4 11" strokeWidth="1" />
          <path d="M190 138q8-11 17 0q-8 11-17 0z" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}
