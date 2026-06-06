import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuizPanel from './QuizPanel';
import {
  fetchQuizSubjects,
  startQuiz,
  gradeQuizAnswer,
} from '../lib/quizApi';

// The quiz API is fully mocked — these tests exercise the panel's wiring, not
// the network. (Auto-mocked fns: matchVoiceAnswer is present but unused here.)
jest.mock('../lib/quizApi');

const SUBJECT = { id: 'physics', name_ar: 'الفيزياء', name_en: 'Physics', language: 'ar' };
const QUESTION = {
  number: 1,
  total: 1,
  subject: 'physics',
  language: 'ar',
  question: 'ما هي وحدة القوة؟',
  options: ['نيوتن', 'جول', 'واط', 'باسكال'],
  topic: 'وحدات',
  token: 'sealed-token-1',
};

beforeEach(() => {
  fetchQuizSubjects.mockResolvedValue([SUBJECT]);
  startQuiz.mockResolvedValue([QUESTION]);
  gradeQuizAnswer.mockResolvedValue({
    result: { correct: true, correct_index: 0, explanation: 'صحيح', number: 1 },
    quiz: { subject: 'physics', difficulty: 'medium', total: 1, index: 1, score: 1 },
    final: { score: 1, total: 1, assessment: { level: 'متقدم', ratio: 1 } },
  });
});

afterEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

// Issue #1: clicking an option then "تأكيد الإجابة" must grade with the numeric
// INDEX — never the click event — so the sealed-token grade accepts the payload
// and the student never sees "تعذر التحقق من الإجابة".
test('manual click grades with an integer index and shows no verification error', async () => {
  render(<QuizPanel profile={{ name: 'تجريبي' }} />);

  fireEvent.click(await screen.findByRole('button', { name: /الفيزياء/ }));
  fireEvent.click(await screen.findByRole('button', { name: /ابدأ الاختبار/ }));

  // Pick option أ then confirm.
  fireEvent.click(await screen.findByRole('button', { name: /نيوتن/ }));
  fireEvent.click(screen.getByRole('button', { name: 'تأكيد الإجابة' }));

  await waitFor(() => expect(gradeQuizAnswer).toHaveBeenCalledTimes(1));
  const payload = gradeQuizAnswer.mock.calls[0][0];
  expect(payload.selected).toBe(0); // a number, not a SyntheticEvent
  expect(typeof payload.selected).toBe('number');
  expect(payload.token).toBe('sealed-token-1'); // exact sealed token round-trips

  // The reveal renders and the verification error never appears.
  expect(await screen.findByText('إجابة صحيحة')).toBeInTheDocument();
  expect(
    screen.queryByText(/تعذّر التحقق من الإجابة/),
  ).not.toBeInTheDocument();
});
