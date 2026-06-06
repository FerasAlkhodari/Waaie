// Shared UI constants.

// Single, friendly, motivational fallback shown for ANY backend/network/stream
// failure — in the text chat AND inside the voice call. Students never see raw
// status codes, JSON, or stack traces. Kept here (one source of truth) so the
// typed-chat and voice paths surface the byte-identical recovery notice.
export const FRIENDLY_ERROR =
  'يبدو أنني لم أفهمك جيداً بسبب الضغط العالي، يرجى إعادة إرسال سؤالك مرة أخرى لأختبرك فيه!';
