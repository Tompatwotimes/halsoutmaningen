import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProofImagePicker } from './ProofImagePicker';

beforeAll(() => {
  // jsdom implements neither of these.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

function makeImage(name = 'foto.jpg'): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

/** Wrapper that owns the file state, like the real forms do. */
function Harness({ onChange }: { onChange?: (f: File | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <ProofImagePicker
      file={file}
      onChange={(f) => {
        setFile(f);
        onChange?.(f);
      }}
      idPrefix="test-proof"
    />
  );
}

function cameraInput() {
  return document.getElementById('test-proof-camera') as HTMLInputElement;
}
function galleryInput() {
  return document.getElementById('test-proof-gallery') as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProofImagePicker', () => {
  it('offers both a camera and a gallery choice', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Ta foto' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Välj från bilder' }),
    ).toBeInTheDocument();
  });

  it('camera input uses environment capture', () => {
    render(<Harness />);
    expect(cameraInput()).toHaveAttribute('capture', 'environment');
    expect(cameraInput()).toHaveAttribute('accept', 'image/*');
  });

  it('gallery input must not set capture', () => {
    render(<Harness />);
    expect(galleryInput()).not.toHaveAttribute('capture');
    expect(galleryInput()).toHaveAttribute('accept', 'image/*');
  });

  it('the camera path feeds the shared file handler', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    const file = makeImage('camera.jpg');
    await user.upload(cameraInput(), file);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(file));
    expect(
      await screen.findByAltText('Förhandsvisning av bildbevis'),
    ).toBeInTheDocument();
  });

  it('the gallery path feeds the same shared file handler', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);

    const file = makeImage('gallery.jpg');
    await user.upload(galleryInput(), file);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(file));
    expect(
      await screen.findByAltText('Förhandsvisning av bildbevis'),
    ).toBeInTheDocument();
  });

  it('removing the selection returns to the two choices without error', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(galleryInput(), makeImage());
    const remove = await screen.findByRole('button', { name: 'Ta bort bild' });
    await user.click(remove);

    expect(screen.getByRole('button', { name: 'Ta foto' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Välj från bilder' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText('Förhandsvisning av bildbevis'),
    ).not.toBeInTheDocument();
  });
});
