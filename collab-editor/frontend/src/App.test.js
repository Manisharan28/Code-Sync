import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

jest.mock('@monaco-editor/react', () => (props) => {
  const { value, onChange } = props;
  return (
    <textarea
      aria-label="code editor"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
});

jest.mock('./socket', () => ({
  BACKEND_URL: 'http://localhost:5000',
  socket: {
    connected: false,
    emit: jest.fn(),
    off: jest.fn(),
    on: jest.fn(),
  },
}));

test('renders CodeSync landing page', () => {
  render(<App />);
  expect(screen.getAllByText(/CodeSync/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/Code together/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
});

test('shows nickname modal on Create Room click', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /create room/i }));
  expect(screen.getByText(/create a new room/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/devmaster/i)).toBeInTheDocument();
});
