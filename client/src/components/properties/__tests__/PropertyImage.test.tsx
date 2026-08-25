/**
 * The count used to be `1/{Math.random()}` — a different number every render, implying
 * photos that do not exist. It must come from the array, and never appear for 0 or 1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PropertyImage } from '../PropertyImage';

const COUNT_RE = /^\s*\d+\s*\/\s*\d+\s*$/;
const ph = <span>placeholder</span>;

beforeEach(cleanup);

describe('PropertyImage', () => {
  it('renders the placeholder and no count when images is absent', () => {
    render(<PropertyImage>{ph}</PropertyImage>);
    expect(screen.getByText('placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(COUNT_RE)).not.toBeInTheDocument();
  });

  it('treats an empty array as absent', () => {
    render(<PropertyImage images={[]}>{ph}</PropertyImage>);
    expect(screen.getByText('placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('ignores blank and whitespace-only entries', () => {
    render(<PropertyImage images={['', '   ']}>{ph}</PropertyImage>);
    expect(screen.getByText('placeholder')).toBeInTheDocument();
    expect(screen.queryByText(COUNT_RE)).not.toBeInTheDocument();
  });

  it('shows one image with no count, and drops the placeholder', () => {
    render(<PropertyImage images={['/only.jpg']} alt="Villa">{ph}</PropertyImage>);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/only.jpg');
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Villa');
    expect(screen.queryByText(COUNT_RE)).not.toBeInTheDocument();
    expect(screen.queryByText('placeholder')).not.toBeInTheDocument();
  });

  it('shows the first image and the real count when several exist', () => {
    render(<PropertyImage images={['/a.jpg', '/b.jpg', '/c.jpg']}>{ph}</PropertyImage>);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/a.jpg');
    expect(screen.getByText(COUNT_RE)).toHaveTextContent('1/3');
  });

  it('counts only the real entries, not the blanks', () => {
    render(<PropertyImage images={['/a.jpg', '', '/b.jpg']}>{ph}</PropertyImage>);
    expect(screen.getByText(COUNT_RE)).toHaveTextContent('1/2');
  });

  it('falls back to a generic alt when none is given', () => {
    render(<PropertyImage images={['/a.jpg']}>{ph}</PropertyImage>);
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Property');
  });
});
