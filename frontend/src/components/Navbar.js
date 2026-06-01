import React from 'react';
import BrandLogo from './BrandLogo';

function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800/50 bg-zinc-950/70 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-9 w-9 drop-shadow-[0_0_8px_rgba(224,168,107,0.15)]" />
          <div className="leading-tight">
            <h1 className="text-[0.95rem] font-bold tracking-tight text-zinc-100">
              واعي
            </h1>
            <p className="text-xs font-medium text-zinc-500">
              مرشدك في تقنية المعلومات والأمن السيبراني
            </p>
          </div>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
          متصل
        </span>
      </div>
    </header>
  );
}

export default React.memo(Navbar);
