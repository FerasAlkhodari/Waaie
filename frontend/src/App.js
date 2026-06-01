import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import MarkdownMessage from './components/MarkdownMessage';
import Navbar from './components/Navbar';
import BrandLogo from './components/BrandLogo';

const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const SendIcon = React.memo(function SendIcon({ className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* arrow points right→left for RTL send affordance */}
      <path
        d="M19 12H5M5 12L11 6M5 12L11 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});

const TypingIndicator = React.memo(function TypingIndicator() {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-2 flex items-center gap-2.5">
        <BrandLogo className="h-7 w-7" />
        <span className="text-xs font-semibold tracking-wide text-zinc-500">
          واعي يكتب…
        </span>
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-zinc-800/60 bg-zinc-900/50 px-5 py-4 shadow-panel backdrop-blur-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-accent/90 animate-bounce"
            style={{ animationDelay: `${i * 0.16}s`, animationDuration: '0.9s' }}
          />
        ))}
      </div>
    </div>
  );
});

const UserBubble = React.memo(function UserBubble({ text }) {
  return (
    <div className="flex animate-fade-in-up justify-start">
      <div className="max-w-[78%] rounded-2xl rounded-tr-md border border-zinc-700/50 bg-zinc-800/60 px-5 py-3 text-[0.97rem] font-medium leading-relaxed text-zinc-100 shadow-panel backdrop-blur-sm">
        {text}
      </div>
    </div>
  );
});

const BotBubble = React.memo(function BotBubble({ text, isError }) {
  return (
    <div className="animate-fade-in-up">
      <div className="mb-2 flex items-center gap-2.5">
        <BrandLogo className="h-7 w-7" />
        <span className="text-xs font-semibold tracking-wide text-zinc-500">
          واعي
        </span>
      </div>
      <div
        className={`rounded-2xl rounded-tl-md border px-6 py-5 shadow-panel backdrop-blur-sm sm:px-7 sm:py-6 ${
          isError
            ? 'border-red-500/30 bg-red-950/20'
            : 'border-zinc-800/60 bg-zinc-900/40'
        }`}
      >
        {isError ? (
          <p className="text-[0.95rem] leading-relaxed text-red-300">{text}</p>
        ) : (
          <MarkdownMessage content={text} />
        )}
      </div>
    </div>
  );
});

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, loading]);

  const autoGrow = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const handleSendMessage = async () => {
    const question = input.trim();
    if (!question || loading) {
      return;
    }

    setMessages((prev) => [...prev, { text: question, sender: 'user' }]);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setLoading(true);

    try {
      const { data } = await axios.post(`${BACKEND_URL}/ask`, { question });
      const answer =
        data?.data?.answer ||
        data?.message ||
        'لم أتمكن من العثور على إجابة.';
      setMessages((prev) => [...prev, { text: answer, sender: 'bot' }]);
    } catch (error) {
      const detail =
        error?.response?.data?.detail ||
        'تعذّر الاتصال بالخادم. حاول مرة أخرى.';
      setMessages((prev) => [
        ...prev,
        { text: detail, sender: 'bot', isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      dir="rtl"
      className="relative flex min-h-screen flex-col bg-zinc-950 text-zinc-200"
    >
      {/* Ambient layered background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_-10%,rgba(224,168,107,0.07),transparent_45%),radial-gradient(circle_at_85%_110%,rgba(120,113,108,0.06),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[0.015] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
      </div>

      <Navbar />

      {/* Conversation */}
      <main
        ref={scrollRef}
        className="scrollbar-elegant flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
          {isEmpty ? (
            <div className="flex min-h-[55vh] animate-fade-in flex-col items-center justify-center text-center">
              <BrandLogo className="mb-6 h-16 w-16 drop-shadow-[0_0_18px_rgba(224,168,107,0.18)]" />
              <h2 className="mb-3 text-balance text-2xl font-extrabold tracking-tight text-zinc-100 sm:text-[1.75rem]">
                كيف يمكنني مساعدتك اليوم؟
              </h2>
              <p className="max-w-md text-balance text-[0.95rem] leading-relaxed text-zinc-500">
                اسألني عن مكوّنات الحاسب، أنظمة التشغيل، الشبكات، أو أساسيات
                الأمن السيبراني — بالعربية أو الإنجليزية.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                {[
                  'ما هو الحاسب؟',
                  'اشرح لي ثالوث الـ CIA',
                  'ما الفرق بين TCP و UDP؟',
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm font-medium text-zinc-400 transition-all hover:border-accent/40 hover:text-zinc-200"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-7">
              {messages.map((msg, index) =>
                msg.sender === 'user' ? (
                  <UserBubble key={index} text={msg.text} />
                ) : (
                  <BotBubble
                    key={index}
                    text={msg.text}
                    isError={msg.isError}
                  />
                )
              )}
              {loading && <TypingIndicator />}
            </div>
          )}
        </div>
      </main>

      {/* Composer */}
      <footer className="sticky bottom-0 z-10 border-t border-zinc-800/50 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent pb-5 pt-3">
        <div className="mx-auto w-full max-w-3xl px-5 sm:px-6">
          <div className="group relative flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-2 shadow-panel backdrop-blur-md transition-all duration-300 focus-within:border-accent/50 focus-within:animate-glow-ring">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="اكتب سؤالك هنا…"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoGrow(e.target);
              }}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="scrollbar-elegant max-h-[200px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[0.97rem] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={handleSendMessage}
              disabled={loading || !input.trim()}
              aria-label="إرسال"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-zinc-950 transition-all duration-200 enabled:hover:bg-accent-soft enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2.5 text-center text-[0.7rem] font-medium text-zinc-600">
            قد يقدّم واعي معلومات غير دقيقة. تحقّق من المصادر المهمة.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
