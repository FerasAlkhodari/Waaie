import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import QuizPanel from './components/QuizPanel';
import Onboarding from './components/Onboarding';
import EcosystemHub from './components/EcosystemHub';
import useSessions from './hooks/useSessions';
import useProfile from './hooks/useProfile';

function App() {
  const {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    switchSession,
    deleteSession,
    setActiveMessages,
  } = useSessions();

  const { profile, saveProfile } = useProfile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  // Whether the Ecosystem hub (sister AI platforms) is open over the workspace.
  const [ecosystemOpen, setEcosystemOpen] = useState(false);
  // Which workspace is showing: the chat or the Question Bank (بنك الأسئلة).
  const [view, setView] = useState('chat');

  // Opening a chat (new or existing) always returns to the chat workspace.
  const handleNewChat = () => {
    setView('chat');
    createSession();
  };
  const handleSelectChat = (id) => {
    setView('chat');
    switchSession(id);
  };

  // First-run gate: until we know who the student is, the workspace stays
  // locked behind a full-screen welcome.
  if (!profile) {
    return <Onboarding onSubmit={saveProfile} />;
  }

  return (
    <div
      dir="rtl"
      className="relative flex h-screen overflow-hidden bg-slate-950 text-slate-200"
    >
      {/* Ambient layered background */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/4 right-[-10%] h-[60vh] w-[60vh] rounded-full bg-accent/8 blur-[140px] animate-aurora" />
        <div className="absolute bottom-[-25%] left-[-10%] h-[55vh] w-[55vh] rounded-full bg-sky-500/[0.06] blur-[140px] animate-aurora-alt" />
        <div className="absolute inset-0 opacity-[0.015] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
        <div className="absolute inset-0 bg-noise opacity-[0.025] mix-blend-soft-light" />
      </div>

      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        activeView={view}
        onNew={handleNewChat}
        onSelect={handleSelectChat}
        onOpenQuiz={() => setView('quiz')}
        onOpenEcosystem={() => setEcosystemOpen(true)}
        onDelete={deleteSession}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        profile={profile}
        onEditProfile={() => setEditingProfile(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar onMenuClick={() => setDrawerOpen(true)} />
        {view === 'quiz' ? (
          <QuizPanel profile={profile} />
        ) : (
          <ChatPanel
            key={activeSessionId}
            sessionId={activeSessionId}
            initialMessages={activeSession?.messages || []}
            onMessagesChange={setActiveMessages}
          />
        )}
      </div>

      {/* Profile editor — overlays the workspace without tearing it down */}
      {editingProfile && (
        <Onboarding
          initial={profile}
          allowCancel
          onCancel={() => setEditingProfile(false)}
          onSubmit={(next) => {
            saveProfile(next);
            setEditingProfile(false);
          }}
        />
      )}

      {/* Ecosystem hub — sister AI platforms. Rendered at the app root (not
          inside the transformed sidebar) so its fixed overlay covers the
          viewport correctly. */}
      {ecosystemOpen && (
        <EcosystemHub onClose={() => setEcosystemOpen(false)} />
      )}
    </div>
  );
}

export default App;
