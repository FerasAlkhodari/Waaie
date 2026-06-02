/* eslint-disable jsx-a11y/heading-has-content, jsx-a11y/anchor-has-content */
// Content is injected by react-markdown via children at render time,
// so the static a11y checks for heading/anchor content are false positives.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Editorial markdown renderer: strong hierarchy, custom bullets,
// border-led sections, refined code surfaces. Tuned for RTL Arabic.
const components = {
  h1: ({ node, ...props }) => (
    <h1
      className="mt-7 mb-3 text-[1.55rem] font-extrabold tracking-tight text-slate-50 first:mt-0"
      {...props}
    />
  ),
  h2: ({ node, ...props }) => (
    <h2
      className="mt-7 mb-3 flex items-center gap-3 text-xl font-bold tracking-tight text-slate-50 first:mt-0 before:h-5 before:w-[3px] before:rounded-full before:bg-accent"
      {...props}
    />
  ),
  h3: ({ node, ...props }) => (
    <h3
      className="mt-5 mb-2 text-base font-bold text-accent-soft first:mt-0"
      {...props}
    />
  ),
  p: ({ node, ...props }) => (
    <p
      className="my-3 text-[0.975rem] leading-[1.95] text-slate-300 first:mt-0 last:mb-0"
      {...props}
    />
  ),
  strong: ({ node, ...props }) => (
    <strong className="font-bold text-slate-100" {...props} />
  ),
  em: ({ node, ...props }) => (
    <em className="text-slate-200 not-italic font-medium" {...props} />
  ),
  ul: ({ node, ...props }) => (
    <ul className="my-4 space-y-2.5 ps-1" {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol
      className="my-4 space-y-2.5 ps-5 list-decimal marker:text-accent marker:font-bold"
      {...props}
    />
  ),
  li: ({ node, ordered, ...props }) =>
    ordered ? (
      <li className="ps-1 text-[0.95rem] leading-[1.85] text-slate-300" {...props} />
    ) : (
      <li
        className="relative ps-5 text-[0.95rem] leading-[1.85] text-slate-300 before:absolute before:top-[0.72em] before:start-0 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-[2px] before:bg-accent/80"
        {...props}
      />
    ),
  a: ({ node, ...props }) => (
    <a
      className="font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-soft hover:decoration-accent"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  blockquote: ({ node, ...props }) => (
    <blockquote
      className="my-4 border-s-2 border-accent/40 bg-slate-800/30 px-4 py-2 text-slate-300"
      {...props}
    />
  ),
  hr: () => <hr className="my-6 border-slate-800" />,
  code: ({ node, inline, className, children, ...props }) =>
    inline ? (
      <code
        className="rounded-md border border-slate-700/60 bg-slate-800/70 px-1.5 py-0.5 font-mono text-[0.85em] text-accent-soft"
        dir="ltr"
        {...props}
      >
        {children}
      </code>
    ) : (
      <code
        className="block font-mono text-[0.85rem] leading-relaxed text-slate-200"
        dir="ltr"
        {...props}
      >
        {children}
      </code>
    ),
  pre: ({ node, ...props }) => (
    <pre
      className="scrollbar-elegant my-4 overflow-x-auto rounded-xl border border-slate-800 bg-[#0c0c0f] p-4 text-start"
      dir="ltr"
      {...props}
    />
  ),
  table: ({ node, ...props }) => (
    <div className="scrollbar-elegant my-4 overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th
      className="border-b border-slate-800 bg-slate-800/40 px-3 py-2 text-start font-semibold text-slate-200"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td className="border-b border-slate-800/60 px-3 py-2 text-slate-300" {...props} />
  ),
};

function MarkdownMessage({ content }) {
  return (
    <div className="text-slate-300">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default React.memo(MarkdownMessage);
