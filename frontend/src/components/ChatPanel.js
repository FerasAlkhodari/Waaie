import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownMessage from './MarkdownMessage';
import BrandLogo from './BrandLogo';
import VoiceCall from './VoiceCall';
import { MicIcon } from './icons';
import { askQuestionStream, askDocumentStream } from '../lib/sessionApi';
import { FRIENDLY_ERROR } from '../lib/constants';

const ACCEPTED_TYPES = '.pdf,.docx,.xlsx';
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.xlsx'];

// Distance (px) from the bottom within which we still consider the user "at the
// bottom" and keep auto-scrolling. Scrolling further up than this freezes the
// auto-follow so streamed tokens don't snap the view back down.
const SCROLL_STICK_THRESHOLD_PX = 80;

const isAcceptedFile = (file) =>
  !!file &&
  ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));

const AttachIcon = React.memo(function AttachIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
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
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
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
            style={{ animationDelay: `${i * 0.16}s`, animationDuration: '1s' }}
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

const BotBubble = React.memo(function BotBubble({ text, isError, streaming }) {
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
          <>
            <MarkdownMessage content={text} />
            {streaming && (
              // Blinking caret while tokens are still arriving — removed the
              // instant the answer settles into a normal bot message.
              <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-accent align-text-bottom" />
            )}
          </>
        )}
      </div>
    </div>
  );
});

// Centered, non-vocal pill marking a voice-call lifecycle event in the chat
// (e.g. "⚡ call started" / "🛑 call ended"). Distinct from user/bot bubbles.
const SystemLog = React.memo(function SystemLog({ text }) {
  return (
    <div className="flex animate-fade-in justify-center">
      <span className="rounded-full border border-slate-800/70 bg-slate-900/60 px-4 py-1.5 text-xs font-medium text-slate-400 shadow-panel">
        {text}
      </span>
    </div>
  );
});

function ChatPanel({ sessionId, initialMessages, onMessagesChange }) {
  const [messages, setMessages] = useState(initialMessages || []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  // Pending requestAnimationFrame id for batching streamed token updates into
  // one paint per frame (see handleSendMessage).
  const rafRef = useRef(null);
  // Whether the conversation is pinned to the bottom. Flips to false as soon as
  // the user scrolls up to re-read, so incoming tokens don't snap them back.
  const stickToBottomRef = useRef(true);

  // Cancel any in-flight token-flush frame if the panel unmounts mid-stream
  // (e.g. switching sessions) so we never call setState on a gone component.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Persist message changes up to the session store, but skip the initial
  // mount so merely opening a session doesn't rewrite its recency/title.
  const onChangeRef = useRef(onMessagesChange);
  onChangeRef.current = onMessagesChange;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Skip intermediate streaming frames — persist once the live bubble settles
    // (streaming flag cleared) so we write localStorage once per answer, not
    // once per token.
    const last = messages[messages.length - 1];
    if (last && last.streaming) return;
    onChangeRef.current(messages);
  }, [messages]);

  // Focus the composer whenever this panel mounts (new chat / switch).
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Update the "pinned to bottom" flag whenever the user scrolls. Once they
  // scroll further than the threshold above the bottom, auto-follow pauses.
  const handleChatScroll = useCallback((e) => {
    const el = e.currentTarget;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <
      SCROLL_STICK_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    // Smart auto-scroll: only follow new content while the user is still pinned
    // to the bottom. If they've scrolled up to read, leave their view alone.
    if (!el || !stickToBottomRef.current) return;
    // Instant follow while streaming (smooth scroll restarts every frame and
    // would never catch up); smooth elsewhere.
    const last = messages[messages.length - 1];
    const behavior = last && last.streaming ? 'auto' : 'smooth';
    el.scrollTo({ top: el.scrollHeight, behavior });
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

    // Sending your own message always snaps you to the bottom, regardless of
    // where you'd scrolled — then the smart auto-scroll follows the response.
    stickToBottomRef.current = true;
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

    // --- Token streaming ------------------------------------------------------
    // `acc` accumulates raw tokens. The live bot bubble is appended lazily on
    // the FIRST token, so the 3-dot typing indicator stays up until text truly
    // begins (loading) and then hands off seamlessly to the streaming bubble.
    // Token updates are coalesced to one paint per animation frame to keep
    // markdown re-rendering smooth even on long answers.
    let started = false;
    let acc = '';

    const flush = () => {
      rafRef.current = null;
      setMessages((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        if (!last || !last.streaming) return prev;
        const next = prev.slice();
        next[next.length - 1] = { ...last, text: acc };
        return next;
      });
    };
    const scheduleFlush = () => {
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };
    const cancelFlush = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const onDelta = (chunk) => {
      if (!chunk) return;
      acc += chunk;
      if (!started) {
        started = true;
        // First token arrived: retire the typing indicator and open the live
        // bubble that the subsequent deltas stream into.
        setLoading(false);
        setMessages((prev) => [
          ...prev,
          { text: '', sender: 'bot', streaming: true },
        ]);
      }
      scheduleFlush();
    };

    try {
      if (attached) {
        await askDocumentStream({ file: attached, question, sessionId, onDelta });
      } else {
        await askQuestionStream({ question, sessionId, onDelta });
      }

      // Stream finished cleanly: commit the full text and clear the streaming
      // flag so the bubble settles into a normal (persisted) bot message.
      cancelFlush();
      const finalText = acc.trim() || 'لم أتمكن من العثور على إجابة.';
      setMessages((prev) => {
        const next = prev.slice();
        const last = next[next.length - 1];
        if (last && last.streaming) {
          next[next.length - 1] = { text: finalText, sender: 'bot' };
        } else {
          next.push({ text: finalText, sender: 'bot' });
        }
        return next;
      });
    } catch (error) {
      // Absolute zero raw error leakage. Whether the stream failed to initialize
      // or broke midway, discard any partial bubble and show the one friendly,
      // motivational Arabic recovery notice — never a status code or stack.
      cancelFlush();
      setMessages((prev) => {
        const next =
          prev.length && prev[prev.length - 1].streaming
            ? prev.slice(0, -1)
            : prev.slice();
        next.push({ text: FRIENDLY_ERROR, sender: 'bot', isError: true });
        return next;
      });
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

  // --- Voice call wiring ------------------------------------------------------
  const appendSystemMessage = useCallback((text) => {
    setMessages((prev) => [...prev, { text, sender: 'system' }]);
  }, []);

  const handleCallStart = useCallback(() => {
    appendSystemMessage('⚡ تم بدء مكالمة صوتية');
  }, [appendSystemMessage]);

  const handleCallEnd = useCallback(() => {
    appendSystemMessage('🛑 تم إنهاء مكالمة صوتية');
  }, [appendSystemMessage]);

  // Merge a finished voice call's dialogue into the persistent chat. Each turn
  // becomes a user bubble (the transcribed question) followed by a bot bubble
  // (the model's fully streamed spoken answer), appended in order so the voice
  // exchange lives alongside the typed conversation and is saved to
  // localStorage by the normal messages effect.
  const handleVoiceTurns = useCallback((turns) => {
    if (!Array.isArray(turns) || turns.length === 0) return;
    setMessages((prev) => {
      const additions = [];
      turns.forEach((turn) => {
        const userText = (turn?.user || '').trim();
        const assistantText = (turn?.assistant || '').trim();
        if (userText) additions.push({ text: userText, sender: 'user' });
        if (assistantText) additions.push({ text: assistantText, sender: 'bot' });
      });
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, []);

  const handleCallClose = useCallback(() => {
    setCallOpen(false);
    // Return focus to the composer so the user can type immediately. The modal
    // had pulled focus; without this the textarea feels "stuck" after a call.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // Snapshot of the visible conversation handed to the voice bot for context:
  // user/bot turns only (no system pills, no error bubbles), last 20, mapped to
  // the OpenAI {role, content} shape.
  const voiceHistory = useMemo(
    () =>
      messages
        .filter(
          (m) => (m.sender === 'user' || m.sender === 'bot') && !m.isError,
        )
        .slice(-20)
        .map((m) => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text,
        })),
    [messages],
  );

  const isEmpty = messages.length === 0;

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {/* Drag-and-drop overlay — shown while a file hovers over the chat */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-accent/60 bg-slate-900/60 px-12 py-10 shadow-panel">
            <AttachIcon className="h-12 w-12 text-accent" />
            <p className="text-lg font-bold text-slate-100">أفلت الملف هنا للرفع</p>
            <p className="text-sm font-medium text-slate-400">
              PDF أو Word أو Excel
            </p>
          </div>
        </div>
      )}

      {/* Conversation */}
      <main
        ref={scrollRef}
        onScroll={handleChatScroll}
        className="scrollbar-elegant flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">
          {isEmpty ? (
            <div className="flex min-h-[55vh] animate-fade-in flex-col items-center justify-center text-center">
              <BrandLogo className="mb-6 h-16 w-16 animate-float drop-shadow-glow" />
              <h2 className="mb-3 text-balance text-2xl font-extrabold tracking-tight text-slate-100 sm:text-[1.75rem]">
                كيف يمكنني <span className="text-gradient">مساعدتك</span> اليوم؟
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
                  <UserBubble key={index} text={msg.text} fileName={msg.fileName} />
                ) : msg.sender === 'system' ? (
                  <SystemLog key={index} text={msg.text} />
                ) : (
                  <BotBubble
                    key={index}
                    text={msg.text}
                    isError={msg.isError}
                    streaming={msg.streaming}
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
            <button
              onClick={() => setCallOpen(true)}
              disabled={loading}
              aria-label="بدء مكالمة صوتية"
              title="مكالمة صوتية مع واعي"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/5 text-accent/80 transition-all duration-200 enabled:hover:border-accent/50 enabled:hover:bg-accent/10 enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MicIcon className="h-5 w-5" />
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-deep via-accent to-accent-soft text-slate-950 shadow-glow-accent transition-all duration-200 enabled:hover:brightness-110 enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:bg-none disabled:text-slate-600 disabled:shadow-none"
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-2.5 text-center text-[0.7rem] font-medium text-slate-500">
            قد يقدّم واعي معلومات غير دقيقة. تحقّق من المصادر المهمة.
          </p>
        </div>
      </footer>

      {callOpen && (
        <VoiceCall
          sessionId={sessionId}
          history={voiceHistory}
          onCallStart={handleCallStart}
          onCallEnd={handleCallEnd}
          onVoiceTurns={handleVoiceTurns}
          onClose={handleCallClose}
        />
      )}
    </div>
  );
}

export default ChatPanel;
