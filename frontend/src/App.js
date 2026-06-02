import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import MarkdownMessage from './components/MarkdownMessage';
import Navbar from './components/Navbar';
import BrandLogo from './components/BrandLogo';

const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const ACCEPTED_TYPES = '.pdf,.docx,.xlsx';
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx'];

// Single, friendly, motivational fallback shown for ANY backend/network
// failure — students never see raw status codes, JSON, or stack traces.
const FRIENDLY_ERROR =
  'يبدو أنني لم أفهمك جيداً بسبب الضغط العالي، يرجى إعادة إرسال سؤالك مرة أخرى لأختبرك فيه!';

const isAcceptedFile = (file) =>
  !!file &&
  ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));

const AttachIcon = React.memo(function AttachIcon({ className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 01-7.78-7.78l8.49-8.49a3.5 3.5 0 014.95 4.95l-8.49 8.49a1.5 1.5 0 01-2.12-2.12l7.78-7.78"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
});

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
        <span className="text-xs font-semibold tracking-wide text-slate-500">
          واعي يكتب…
        </span>
      </div>
      <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-slate-800/60 bg-slate-900/50 px-5 py-4 shadow-panel backdrop-blur-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 animate-bounce rounded-full bg-gradient-to-b from-accent-soft to-accent shadow-[0_0_8px_rgba(45,212,191,0.45)]"
            style={{ animationDelay: `${i * 0.18}s`, animationDuration: '1s' }}
          />
        ))}
      </div>
    </div>
  );
});

const UserBubble = React.memo(function UserBubble({ text, fileName }) {
  return (
    <div className="flex animate-fade-in-up justify-start">
      <div className="max-w-[78%] rounded-2xl rounded-tr-md border border-slate-700/50 bg-slate-800/60 px-5 py-3 text-[0.97rem] font-medium leading-relaxed text-slate-100 shadow-panel backdrop-blur-sm">
        {fileName && (
          <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            <AttachIcon className="h-3.5 w-3.5" />
            {fileName}
          </div>
        )}
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
        <span className="text-xs font-semibold tracking-wide text-slate-500">
          واعي
        </span>
      </div>
      <div
        className={`rounded-2xl rounded-tl-md border px-6 py-5 shadow-panel backdrop-blur-sm sm:px-7 sm:py-6 ${
          isError
            ? 'border-accent/25 bg-accent/5'
            : 'border-slate-800/60 bg-slate-900/40'
        }`}
      >
        {isError ? (
          <p className="text-[0.95rem] leading-relaxed text-slate-300">{text}</p>
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
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

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

  const handleFileSelect = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
    }
    // Reset so selecting the same file again re-triggers onChange.
    e.target.value = '';
  };

  const handleSendMessage = async () => {
    const question = input.trim();
    if ((!question && !file) || loading) {
      return;
    }

    const attached = file;
    const userText =
      question || (attached ? `سؤال حول المستند: ${attached.name}` : '');

    setMessages((prev) => [
      ...prev,
      { text: userText, sender: 'user', fileName: attached?.name },
    ]);
    setInput('');
    setFile(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setLoading(true);

    try {
      let data;
      if (attached) {
        const form = new FormData();
        form.append('file', attached);
        form.append('question', question);
        ({ data } = await axios.post(`${BACKEND_URL}/ask-document`, form));
      } else {
        ({ data } = await axios.post(`${BACKEND_URL}/ask`, { question }));
      }
      const answer =
        data?.data?.answer ||
        data?.message ||
        'لم أتمكن من العثور على إجابة.';
      setMessages((prev) => [...prev, { text: answer, sender: 'bot' }]);
    } catch (error) {
      // Absolute zero raw error leakage: any status code (429/500/timeout/
      // network) collapses to one friendly, motivational Arabic message.
      setMessages((prev) => [
        ...prev,
        { text: FRIENDLY_ERROR, sender: 'bot', isError: true },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!loading) setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Ignore leave events fired while moving over child elements.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (loading) return;
    const dropped = e.dataTransfer?.files?.[0];
    if (isAcceptedFile(dropped)) {
      setFile(dropped);
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
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex min-h-screen flex-col bg-slate-950 text-slate-200"
    >
      {/* Ambient layered background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_-10%,rgba(45,212,191,0.07),transparent_45%),radial-gradient(circle_at_85%_110%,rgba(56,189,248,0.05),transparent_50%)]" />
        <div className="absolute inset-0 opacity-[0.015] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:44px_44px]" />
      </div>

      {/* Drag-and-drop overlay — shown while a file hovers over the window */}
      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-accent/60 bg-slate-900/60 px-12 py-10 shadow-panel">
            <AttachIcon className="h-12 w-12 text-accent" />
            <p className="text-lg font-bold text-slate-100">
              أفلت الملف هنا للرفع
            </p>
            <p className="text-sm font-medium text-slate-400">
              PDF أو Word أو Excel
            </p>
          </div>
        </div>
      )}

      <Navbar />

      {/* Conversation */}
      <main
        ref={scrollRef}
        className="scrollbar-elegant flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
          {isEmpty ? (
            <div className="flex min-h-[55vh] animate-fade-in flex-col items-center justify-center text-center">
              <BrandLogo className="mb-6 h-16 w-16 drop-shadow-[0_0_18px_rgba(45,212,191,0.2)]" />
              <h2 className="mb-3 text-balance text-2xl font-extrabold tracking-tight text-slate-100 sm:text-[1.75rem]">
                كيف يمكنني مساعدتك اليوم؟
              </h2>
              <p className="max-w-md text-balance text-[0.95rem] leading-relaxed text-slate-400">
                اسألني في الرياضيات، الفيزياء، الكيمياء، الأحياء وعلوم الأرض
                والفضاء، أو التقنية الرقمية والحاسب — بالعربية أو الإنجليزية.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-2.5">
                {[
                  'حل المعادلة: x² − 5x + 6 = 0',
                  'اشرح قانون نيوتن الثاني للحركة',
                  'ما هو الجدول الدوري للعناصر؟',
                  'كيف تنقسم الخلية؟',
                  'ما الفرق بين المتغيّر والثابت في البرمجة؟',
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-full border border-slate-800 bg-slate-900/50 px-4 py-2 text-sm font-medium text-slate-400 transition-all hover:border-accent/40 hover:text-slate-200"
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
                  <UserBubble
                    key={index}
                    text={msg.text}
                    fileName={msg.fileName}
                  />
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
      <footer className="sticky bottom-0 z-10 border-t border-slate-800/50 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pb-5 pt-3">
        <div className="mx-auto w-full max-w-3xl px-5 sm:px-6">
          {file && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/10 px-3.5 py-2 text-sm font-medium text-accent">
              <span className="flex min-w-0 items-center gap-2">
                <AttachIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{file.name}</span>
              </span>
              <button
                onClick={() => setFile(null)}
                aria-label="إزالة الملف"
                className="shrink-0 rounded-md px-1.5 text-accent/80 transition-colors hover:text-accent"
              >
                ✕
              </button>
            </div>
          )}
          <div className="group relative flex items-end gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-2 shadow-panel backdrop-blur-md transition-all duration-300 focus-within:border-accent/50 focus-within:animate-glow-ring">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              aria-label="إرفاق ملف (PDF أو Word أو Excel)"
              title="إرفاق ملف PDF أو Word أو Excel"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 text-slate-400 transition-all duration-200 enabled:hover:border-accent/40 enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AttachIcon className="h-5 w-5" />
            </button>
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
              className="scrollbar-elegant max-h-[200px] flex-1 resize-none bg-transparent px-3 py-2.5 text-[0.97rem] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={handleSendMessage}
              disabled={loading || (!input.trim() && !file)}
              aria-label="إرسال"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-slate-950 transition-all duration-200 enabled:hover:bg-accent-soft enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2.5 text-center text-[0.7rem] font-medium text-slate-500">
            قد يقدّم واعي معلومات غير دقيقة. تحقّق من المصادر المهمة.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
