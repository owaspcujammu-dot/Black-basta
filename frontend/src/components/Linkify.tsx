import { Fragment } from 'react';

// Only web links become clickable; anything else (javascript:, data:, …) stays plain text.
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** Plain text with http(s) links made clickable. Text is never parsed as HTML. */
export function Linkify({ text }: { text: string }) {
  const parts: (string | { href: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    // Keep sentence punctuation after a link out of the link ("see http://x.io.").
    const href = match[0].replace(TRAILING, '');
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ href });
    last = start + href.length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return (
    <>
      {parts.map((part, index) =>
        typeof part === 'string' ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all font-semibold text-blood-500 underline underline-offset-2 hover:text-blood-400">
            {part.href}
          </a>
        ),
      )}
    </>
  );
}
