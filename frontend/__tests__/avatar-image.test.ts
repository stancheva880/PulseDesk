import { describe, expect, it } from 'vitest';
import { AvatarImageError, compressAvatarFile } from '@/lib/avatar-image';

// The happy path draws through <canvas>, which jsdom does not implement without the optional
// `canvas` native package (not a dependency here) — component tests mock this module instead
// (see __tests__/profile.test.tsx) and exercise the upload flow through that seam. These two
// guard clauses run before canvas is ever touched, so they are real coverage, not a stand-in.
describe('compressAvatarFile', () => {
  it('rejects a non-image file', async () => {
    const file = new File(['not a picture'], 'notes.txt', { type: 'text/plain' });
    await expect(compressAvatarFile(file)).rejects.toBeInstanceOf(AvatarImageError);
  });

  it('rejects a file over the source-size cap', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    const file = new File([big], 'huge.png', { type: 'image/png' });
    await expect(compressAvatarFile(file)).rejects.toBeInstanceOf(AvatarImageError);
  });
});
