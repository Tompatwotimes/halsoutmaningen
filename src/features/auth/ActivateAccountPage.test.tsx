import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

const { useAuthMock, setSessionMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn<() => Record<string, unknown>>(),
  setSessionMock: vi.fn<
    (args: { access_token: string; refresh_token: string }) => Promise<{
      data: { session: unknown };
      error: unknown;
    }>
  >(),
}));

vi.mock('./useAuth', () => ({ useAuth: () => useAuthMock() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { setSession: setSessionMock } },
}));

import { ActivateAccountPage } from './ActivateAccountPage';

const updatePassword =
  vi.fn<(password: string) => Promise<{ error: string | null }>>();

function mockAuth(overrides: Record<string, unknown> = {}) {
  useAuthMock.mockReturnValue({
    session: null,
    initializing: false,
    updatePassword,
    ...overrides,
  });
}

const makeTree = (): ReactElement => (
  <MemoryRouter initialEntries={['/aktivera']}>
    <Routes>
      <Route path="/aktivera" element={<ActivateAccountPage />} />
      <Route path="/" element={<div>Startsidan</div>} />
      <Route path="/logga-in" element={<div>Inloggningssidan</div>} />
    </Routes>
  </MemoryRouter>
);

function setUrl(pathWithHashOrQuery: string) {
  window.history.replaceState({}, '', pathWithHashOrQuery);
}

beforeEach(() => {
  updatePassword.mockResolvedValue({ error: null });
  setSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'u1' } } },
    error: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  setUrl('/');
});

describe('ActivateAccountPage', () => {
  it('shows the password form and does not redirect when an invite session exists', () => {
    mockAuth({ session: { user: { id: 'u1' } } });
    render(makeTree());

    expect(
      screen.getByRole('heading', { name: 'Välj ett lösenord' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Startsidan')).not.toBeInTheDocument();
  });

  it('consumes an implicit-grant invite hash that resolves asynchronously', async () => {
    let resolveSetSession!: (value: {
      data: { session: unknown };
      error: unknown;
    }) => void;
    setSessionMock.mockReturnValue(
      new Promise<{ data: { session: unknown }; error: unknown }>((resolve) => {
        resolveSetSession = resolve;
      }),
    );
    setUrl('/aktivera#access_token=tok-a&refresh_token=tok-b&type=invite');
    mockAuth({ session: null });

    render(makeTree());

    expect(screen.getByRole('status')).toHaveTextContent('Öppnar din inbjudan');

    resolveSetSession({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    });

    expect(await screen.findByLabelText('Välj lösenord')).toBeInTheDocument();
    expect(setSessionMock).toHaveBeenCalledWith({
      access_token: 'tok-a',
      refresh_token: 'tok-b',
    });
  });

  it('shows a link error when the invite hash cannot be turned into a session', async () => {
    setSessionMock.mockResolvedValue({
      data: { session: null },
      error: { message: 'invalid token' },
    });
    setUrl('/aktivera#access_token=tok-a&refresh_token=tok-b&type=invite');
    mockAuth({ session: null });

    render(makeTree());

    expect(
      await screen.findByText(/kunde inte verifieras/i),
    ).toBeInTheDocument();
  });

  it('rejects mismatched passwords without calling updateUser', async () => {
    mockAuth({ session: { user: { id: 'u1' } } });
    render(makeTree());
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Välj lösenord'), 'longenough1');
    await user.type(screen.getByLabelText('Bekräfta lösenord'), 'different22');
    await user.click(screen.getByRole('button', { name: 'Aktivera konto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Lösenorden matchar inte.',
    );
    expect(updatePassword).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Välj ett lösenord' }),
    ).toBeInTheDocument();
  });

  it('rejects a too-short password', async () => {
    mockAuth({ session: { user: { id: 'u1' } } });
    render(makeTree());
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Välj lösenord'), 'short');
    await user.type(screen.getByLabelText('Bekräfta lösenord'), 'short');
    await user.click(screen.getByRole('button', { name: 'Aktivera konto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /minst 8 tecken/,
    );
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('saves the chosen password and moves the user into the app', async () => {
    mockAuth({ session: { user: { id: 'u1' } } });
    render(makeTree());
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Välj lösenord'), 'longenough1');
    await user.type(screen.getByLabelText('Bekräfta lösenord'), 'longenough1');
    await user.click(screen.getByRole('button', { name: 'Aktivera konto' }));

    expect(
      await screen.findByRole('heading', { name: 'Kontot är aktiverat' }),
    ).toBeInTheDocument();
    expect(updatePassword).toHaveBeenCalledWith('longenough1');

    await user.click(
      screen.getByRole('button', { name: 'Fortsätt till appen' }),
    );
    expect(screen.getByText('Startsidan')).toBeInTheDocument();
  });

  it('returns to the form with an error when updateUser fails', async () => {
    updatePassword.mockResolvedValue({ error: 'network' });
    mockAuth({ session: { user: { id: 'u1' } } });
    render(makeTree());
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Välj lösenord'), 'longenough1');
    await user.type(screen.getByLabelText('Bekräfta lösenord'), 'longenough1');
    await user.click(screen.getByRole('button', { name: 'Aktivera konto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Kunde inte spara lösenordet/,
    );
    expect(
      screen.getByRole('heading', { name: 'Välj ett lösenord' }),
    ).toBeInTheDocument();
  });

  it('explains an unusable link when there is no session and no token', () => {
    mockAuth({ session: null, initializing: false });
    render(makeTree());

    expect(
      screen.getByRole('heading', { name: 'Länken fungerar inte' }),
    ).toBeInTheDocument();
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('shows expiry copy when the redirect carries otp_expired', () => {
    setUrl(
      '/aktivera#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    mockAuth({ session: null });
    render(makeTree());

    expect(screen.getByText(/Länken har gått ut/)).toBeInTheDocument();
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('keeps resolving while a PKCE recovery session is still being established', async () => {
    setUrl('/aktivera?code=abc123');
    mockAuth({ session: null, initializing: true });
    const view = render(makeTree());

    expect(screen.getByRole('status')).toHaveTextContent('Öppnar din inbjudan');

    mockAuth({ session: { user: { id: 'u1' } }, initializing: false });
    view.rerender(makeTree());

    expect(await screen.findByLabelText('Välj lösenord')).toBeInTheDocument();
    expect(setSessionMock).not.toHaveBeenCalled();
  });
});
