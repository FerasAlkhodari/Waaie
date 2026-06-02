import React, { useState } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import useSessions from './hooks/useSessions';

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

  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div
      dir="rtl"
      className="relative flex h-screen overflow-hidden bg-slate-950 text-slate-200"
    >
      {/* Ambient layered background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_-10%,rgba(45,212,191,0.07),transparent_45%),radial-gradient(circle_at_85%_110%,rgba(56,189,248,0.05),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[0.015] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
      </div>

      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNew={createSession}
        onSelect={switchSession}
        onDelete={deleteSession}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar onMenuClick={() => setDrawerOpen(true)} />
        <ChatPanel
          key={activeSessionId}
          sessionId={activeSessionId}
          initialMessages={activeSession?.messages || []}
          onMessagesChange={setActiveMessages}
        />
      </div>
    </div>
  );
}

export default App;
