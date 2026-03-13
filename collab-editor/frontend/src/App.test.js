import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

// Mock fetch globally for tests
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 201,
    json: () => Promise.resolve({ roomId: 'testroom', hasPassword: false }),
  })
);

const renderApp = (initialPath = '/') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  );

test('renders CodeSync landing page', () => {
  renderApp('/');
  expect(screen.getAllByText(/CodeSync/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/Code together/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
});

test('shows create room form on Create Room click', () => {
  renderApp('/');
  fireEvent.click(screen.getByRole('button', { name: /create room/i }));
  // After clicking Create Room, the form shows password and custom ID checkbox
  expect(screen.getByText(/Custom Room ID/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/Room password \(optional\)/i)).toBeInTheDocument();
});
