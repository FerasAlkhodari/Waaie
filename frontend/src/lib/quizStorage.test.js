import {
  saveActiveQuiz,
  loadActiveQuiz,
  loadAllActiveQuizzes,
  clearActiveQuiz,
} from './quizStorage';

// A representative mid-quiz snapshot for one subject, paused on Q2.
const midQuiz = (subject, subjectName) => ({
  config: { subject, subjectName, difficulty: 'medium', total: 2 },
  questions: [
    { number: 1, question: 'Q1?', options: ['a', 'b', 'c', 'd'], token: 'tok-1' },
    { number: 2, question: 'Q2?', options: ['a', 'b', 'c', 'd'], token: 'tok-2' },
  ],
  index: 1,
  score: 1,
  review: [{ number: 1, correct: true }],
});

afterEach(() => {
  window.localStorage.clear();
});

test('returns null / empty when nothing is saved', () => {
  expect(loadActiveQuiz('physics')).toBeNull();
  expect(loadAllActiveQuizzes()).toEqual([]);
});

test('save → load round-trips an unfinished quiz, tokens intact (Session Resume)', () => {
  saveActiveQuiz('physics', midQuiz('physics', 'الفيزياء'));
  const restored = loadActiveQuiz('physics');

  expect(restored).not.toBeNull();
  expect(restored.config.subject).toBe('physics');
  expect(restored.index).toBe(1);
  expect(restored.score).toBe(1);
  // Sealed tokens survive the round-trip so grading still verifies on resume.
  expect(restored.questions.map((q) => q.token)).toEqual(['tok-1', 'tok-2']);
});

test('multiple subjects persist side by side without overwriting each other', () => {
  saveActiveQuiz('physics', midQuiz('physics', 'الفيزياء'));
  saveActiveQuiz('chemistry', midQuiz('chemistry', 'الكيمياء'));

  // Both are independently resumable...
  expect(loadActiveQuiz('physics')).not.toBeNull();
  expect(loadActiveQuiz('chemistry')).not.toBeNull();

  // ...and both surface in the home resume list.
  const all = loadAllActiveQuizzes();
  expect(all.map((q) => q.subject).sort()).toEqual(['chemistry', 'physics']);
});

test('clearing one subject leaves the others untouched', () => {
  saveActiveQuiz('physics', midQuiz('physics', 'الفيزياء'));
  saveActiveQuiz('chemistry', midQuiz('chemistry', 'الكيمياء'));

  clearActiveQuiz('physics');

  expect(loadActiveQuiz('physics')).toBeNull();
  expect(loadActiveQuiz('chemistry')).not.toBeNull();
  expect(loadAllActiveQuizzes().map((q) => q.subject)).toEqual(['chemistry']);
});

test('simulates close-and-reopen: a cold load resumes the right question', () => {
  saveActiveQuiz('physics', midQuiz('physics', 'الفيزياء'));
  const reopened = loadActiveQuiz('physics');
  expect(reopened.questions[reopened.index].question).toBe('Q2?');
});

test('a finished quiz (index past the last question) is not resumable', () => {
  const finished = { ...midQuiz('physics', 'الفيزياء'), index: 2 }; // === length
  saveActiveQuiz('physics', finished);
  expect(loadActiveQuiz('physics')).toBeNull();
  expect(loadAllActiveQuizzes()).toEqual([]);
});

test('a malformed/foreign payload never crashes — it just means "no resume"', () => {
  window.localStorage.setItem('waaie.quiz.active.v2', '{not valid json');
  expect(loadAllActiveQuizzes()).toEqual([]);

  window.localStorage.setItem(
    'waaie.quiz.active.v2',
    JSON.stringify({ v: 1, quizzes: { physics: midQuiz('physics', 'x') } }),
  );
  // Wrong schema version → ignored.
  expect(loadAllActiveQuizzes()).toEqual([]);
});
