import React from 'react';
import { GridIcon, ArrowLeftIcon } from './icons';

// Sidebar menu entry that opens the Waaie Ecosystem hub (the sister AI
// platforms). A visual sibling of the "بنك الأسئلة" nav button — same glass
// pill, Slate/Teal tokens, Cairo type — distinguished by the constellation
// glyph and a hover arrow that hints "this opens a wider catalogue".
function EcosystemBar({ onOpen, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="group flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GridIcon className="h-4 w-4" />
      منظومة واعي
      <ArrowLeftIcon className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
    </button>
  );
}

export default React.memo(EcosystemBar);
