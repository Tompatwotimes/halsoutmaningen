import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionForm } from './SessionForm';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

function makeImage(name = 'pass.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

function renderForm(onSubmit = vi.fn()) {
  render(
    <SessionForm
      minMinutes={30}
      proofRequired
      submitting={false}
      submitLabel="Registrera passet"
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

const slot1Gallery = () =>
  document.getElementById('session-proof-1-gallery') as HTMLInputElement;
const slot2Gallery = () =>
  document.getElementById('session-proof-2-gallery') as HTMLInputElement;

describe('SessionForm proof slots', () => {
  it('shows two labelled slots; slot 2 is locked until slot 1 has an image', () => {
    renderForm();
    expect(screen.getByText('Bevis 1')).toBeInTheDocument();
    expect(screen.getByText('Bevis 2')).toBeInTheDocument();
    expect(screen.getByText('Obligatoriskt')).toBeInTheDocument();
    // slot 2 picker is not mounted yet
    expect(slot2Gallery()).toBeNull();
    expect(screen.getByText(/Lägg till Bevis 1 först/i)).toBeInTheDocument();
    // slot 1 camera keeps the direct-capture attribute
    const camera1 = document.getElementById(
      'session-proof-1-camera',
    ) as HTMLInputElement;
    expect(camera1).toHaveAttribute('capture', 'environment');
    expect(slot1Gallery()).not.toHaveAttribute('capture');
  });

  it('submits with only slot 1 filled', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.click(screen.getByRole('button', { name: 'Registrera passet' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText('Bildbevis krävs för det här passet.'),
    ).toBeInTheDocument();

    await user.upload(slot1Gallery(), makeImage('one.jpg'));
    await screen.findByAltText('Förhandsvisning av bildbevis');

    await user.click(screen.getByRole('button', { name: 'Registrera passet' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMinutes: 30,
        proofFiles: [expect.any(File)],
      }),
    );
  });

  it('accepts an optional second image once slot 1 is filled', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.upload(slot1Gallery(), makeImage('selfie.jpg'));
    // slot 2 picker appears
    await waitFor(() => expect(slot2Gallery()).not.toBeNull());
    await user.upload(slot2Gallery(), makeImage('strava.jpg'));
    await waitFor(() =>
      expect(
        screen.getAllByAltText('Förhandsvisning av bildbevis'),
      ).toHaveLength(2),
    );

    await user.click(screen.getByRole('button', { name: 'Registrera passet' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        proofFiles: [expect.any(File), expect.any(File)],
      }),
    );
  });

  it('removing slot 1 also clears slot 2', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.upload(slot1Gallery(), makeImage('a.jpg'));
    await waitFor(() => expect(slot2Gallery()).not.toBeNull());
    await user.upload(slot2Gallery(), makeImage('b.jpg'));
    await waitFor(() =>
      expect(
        screen.getAllByAltText('Förhandsvisning av bildbevis'),
      ).toHaveLength(2),
    );

    // remove slot 1 (first "Ta bort bild" button)
    const [removeSlot1] = screen.getAllByRole('button', {
      name: 'Ta bort bild',
    });
    await user.click(removeSlot1!);
    await waitFor(() =>
      expect(
        screen.queryByAltText('Förhandsvisning av bildbevis'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Lägg till Bevis 1 först/i)).toBeInTheDocument();
  });
});
