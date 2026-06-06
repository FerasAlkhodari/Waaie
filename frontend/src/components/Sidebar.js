import React, { useState } from 'react';
import BrandLogo from './BrandLogo';
import ProfileWidget from './ProfileWidget';
import EcosystemBar from './EcosystemBar';
import { PlusIcon, TrashIcon, CloseIcon, ChatIcon, BankIcon } from './icons';

function SessionRow({ session, isActive, onSelect, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className={`group relative flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-all ${
        isActive
          ? 'border-accent/40 bg-slate-800/70 text-slate-100'
          : 'border-transparent text-slate-400 hover:border-slate-800 hover:bg-slate-900/60 hover:text-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-right"
        title={session.title}
      >
        <ChatIcon
          className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent' : 'text-slate-500'}`}
        />
        <span className="truncate font-medium">{session.title}</span>
      </button>

      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onDelete(session.id)}
            aria-label="تأكيد الحذف"
            className="rounded-md px-1.5 py-0.5 text-xs font-bold text-accent transition-colors hover:text-accent-soft"
          >
            حذف
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            aria-label="إلغاء"
            className="rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300"
          >
            إلغاء
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="حذف المحادثة"
          // Always tappable on touch; reveal on hover/focus on desktop.
          className="shrink-0 rounded-md p-1 text-slate-500 opacity-100 transition-all hover:text-accent focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Sidebar({
  sessions,
  activeSessionId,
  activeView = 'chat',
  onNew,
  onSelect,
  onOpenQuiz,
  onOpenEcosystem,
  onDelete,
  isOpen,
  onClose,
  profile,
  onEditProfile,
}) {
  const ordered = [...sessions].sort((a, b) => b.timestamp - a.timestamp);
  const quizActive = activeView === 'quiz';

  const handleSelect = (id) => {
    onSelect(id);
    onClose();
  };

  const handleNew = () => {
    onNew();
    onClose();
  };

  const handleOpenQuiz = () => {
    onOpenQuiz?.();
    onClose();
  };

  const handleOpenEcosystem = () => {
    onOpenEcosystem?.();
    onClose();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm animate-fade-in md:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed bottom-0 right-0 top-0 z-40 flex w-[280px] flex-col border-l border-slate-800/60 bg-slate-950/95 backdrop-blur-md transition-transform duration-300 md:static md:z-auto md:w-[280px] md:translate-x-0 md:bg-slate-950/40 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header: brand + mobile close */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800/50 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7" />
            <span className="text-sm font-bold tracking-tight text-slate-100">
              واعي
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق القائمة"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:text-slate-100 md:hidden"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Primary nav: new chat + question bank */}
        <div className="space-y-2 px-3 pt-3">
          <button
            type="button"
            onClick={handleNew}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:border-accent/50 hover:text-accent"
          >
            <PlusIcon className="h-4 w-4" />
            محادثة جديدة
          </button>
          <button
            type="button"
            onClick={handleOpenQuiz}
            aria-pressed={quizActive}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all ${
              quizActive
                ? 'border-accent/50 bg-accent/10 text-accent shadow-glow-accent'
                : 'border-slate-800 bg-slate-900/60 text-slate-200 hover:border-accent/50 hover:text-accent'
            }`}
          >
            <BankIcon className="h-4 w-4" />
            بنك الأسئلة
          </button>
          <EcosystemBar onOpen={handleOpenEcosystem} />
        </div>

        {/* Sessions */}
        <nav className="scrollbar-elegant mt-3 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {ordered.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={handleSelect}
              onDelete={onDelete}
            />
          ))}
        </nav>

        {/* Pinned account card */}
        <ProfileWidget profile={profile} onEdit={onEditProfile} />
      </aside>
    </>
  );
}

export default React.memo(Sidebar);
