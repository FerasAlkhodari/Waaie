import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import axios from 'axios';
import App from './App';

// react-markdown is ESM-only and not transformed by CRA's Jest; these UI-state
// tests don't exercise markdown parsing, so stub the renderer with plain text.
jest.mock('./components/MarkdownMessage', () => ({ content }) => (
  <div data-testid="markdown">{content}</div>
));

jest.mock('axios');

const PLACEHOLDER = 'اكتب سؤالك هنا…';
const TYPING_LABEL = 'واعي يكتب…';

function ask(question) {
  const input = screen.getByPlaceholderText(PLACEHOLDER);
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'إرسال' }));
}

afterEach(() => jest.clearAllMocks());

test('renders the empty-state hero and composer', () => {
  render(<App />);
  expect(screen.getByText('كيف يمكنني مساعدتك اليوم؟')).toBeInTheDocument();
  expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
});

test('sends a question, shows the user bubble, then the bot answer', async () => {
  axios.post.mockResolvedValueOnce({
    data: { status: 'success', data: { answer: 'The CIA triad: C, I, A.', language: 'en' } },
  });

  render(<App />);
  ask('What is the CIA triad?');

  // The user's question appears immediately.
  expect(screen.getByText('What is the CIA triad?')).toBeInTheDocument();
  // The bot answer arrives via the (stubbed) markdown renderer.
  await waitFor(() =>
    expect(screen.getByText('The CIA triad: C, I, A.')).toBeInTheDocument()
  );
});

test('TypingIndicator mounts while loading and unmounts after a response', async () => {
  // A deferred promise lets us hold the app in the loading state.
  let resolveRequest;
  axios.post.mockImplementationOnce(
    () => new Promise((resolve) => { resolveRequest = resolve; })
  );

  render(<App />);
  ask('Explain TCP/IP');

  // While the request is in flight, the indicator is mounted...
  expect(screen.getByText(TYPING_LABEL)).toBeInTheDocument();
  // ...with exactly three staggered bounce dots.
  const dots = document.querySelectorAll('.animate-bounce');
  expect(dots).toHaveLength(3);
  dots.forEach((dot, i) => {
    expect(dot.style.animationDelay).toBe(`${i * 0.16}s`);
  });

  // Resolve the request -> the finally block flips loading to false.
  resolveRequest({
    data: { status: 'success', data: { answer: 'TCP is reliable.', language: 'en' } },
  });

  await waitFor(() =>
    expect(screen.queryByText(TYPING_LABEL)).not.toBeInTheDocument()
  );
  expect(document.querySelectorAll('.animate-bounce')).toHaveLength(0);
});

test('finally block unmounts the indicator even when the request fails', async () => {
  let rejectRequest;
  axios.post.mockImplementationOnce(
    () => new Promise((_, reject) => { rejectRequest = reject; })
  );

  render(<App />);
  ask('What is a subnet mask?');

  expect(screen.getByText(TYPING_LABEL)).toBeInTheDocument();

  rejectRequest({ response: { data: { detail: 'Server error' } } });

  // Indicator is torn down (finally) and an error bubble replaces it.
  await waitFor(() =>
    expect(screen.queryByText(TYPING_LABEL)).not.toBeInTheDocument()
  );
  expect(screen.getByText('Server error')).toBeInTheDocument();
});
