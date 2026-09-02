import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionForm } from './SessionForm';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

function makeImage(): File {
  return new File(['x'], 'pass.jpg', { type: 'image/jpeg' });
}

describe('SessionForm proof input', () => {
  it('uses the shared ProofImagePicker (camera + gallery, gallery has no capture)', () => {
    render(
      <SessionForm
        minMinutes={30}
        proofRequired
        submitting={false}
        submitLabel="Registrera passet"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Ta foto' })).toBeInTheDocument();
    const camera = document.getElementById(
      'session-proof-camera',
    ) as HTMLInputElement;
    const gallery = document.getElementById(
      'session-proof-gallery',
    ) as HTMLInputElement;
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(gallery).not.toHaveAttribute('capture');
  });

  it('a gallery-selected image satisfies the proof requirement and submits', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionForm
        minMinutes={30}
        proofRequired
        submitting={false}
        submitLabel="Registrera passet"
        onSubmit={onSubmit}
      />,
    );

    // Proof missing → submit is blocked and the requirement message shows.
    await user.click(screen.getByRole('button', { name: 'Registrera passet' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText('Bildbevis krävs för det här passet.'),
    ).toBeInTheDocument();

    const gallery = document.getElementById(
      'session-proof-gallery',
    ) as HTMLInputElement;
    await user.upload(gallery, makeImage());
    await screen.findByAltText('Förhandsvisning av bildbevis');

    await user.click(screen.getByRole('button', { name: 'Registrera passet' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMinutes: 30,
        proofFile: expect.any(File),
      }),
    );
  });

  it('cancelling clears the selection without breaking the form', async () => {
    const user = userEvent.setup();
    render(
      <SessionForm
        minMinutes={30}
        proofRequired
        submitting={false}
        submitLabel="Registrera passet"
        onSubmit={vi.fn()}
      />,
    );

    const gallery = document.getElementById(
      'session-proof-gallery',
    ) as HTMLInputElement;
    await user.upload(gallery, makeImage());
    await user.click(screen.getByRole('button', { name: 'Ta bort bild' }));

    expect(
      screen.getByRole('button', { name: 'Välj från bilder' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText('Förhandsvisning av bildbevis'),
    ).not.toBeInTheDocument();
  });
});
