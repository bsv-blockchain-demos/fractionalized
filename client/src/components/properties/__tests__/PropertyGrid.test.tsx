/**
 * The image count used to be `1/{Math.floor(Math.random() * 9) + 1}` — a fresh random
 * number every render, implying photos that do not exist. Count must come from images[].
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PropertyGrid from '../PropertyGrid';
import type { PublicProperty } from '@shared/types';

function show(items: PublicProperty[]) {
  return render(<MemoryRouter><PropertyGrid items={items} /></MemoryRouter>);
}

/** The count badge, however it is rendered. */
const COUNT_RE = /^\s*\d+\s*\/\s*\d+\s*$/;

const base: PublicProperty = { _id: 'p1', title: 'Test Property', location: 'Lisbon', priceUSD: 100, status: 'open' };

beforeEach(cleanup);

describe('PropertyGrid images', () => {
  it('renders the grid at all (guards the assertions below against vacuity)', () => {
    show([base]);
    expect(screen.getByText('Test Property')).toBeInTheDocument();
  });

  it('shows no count and a placeholder when there are no images', () => {
    show([base]);
    expect(screen.queryByText(COUNT_RE)).not.toBeInTheDocument();
    expect(screen.getByText('Property Image')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('treats an empty array the same as absent', () => {
    show([{ ...base, images: [] }]);
    expect(screen.queryByText(COUNT_RE)).not.toBeInTheDocument();
    expect(screen.getByText('Property Image')).toBeInTheDocument();
  });

  it('renders the first image and the real count when several exist', () => {
    show([{ ...base, images: ['/a.jpg', '/b.jpg', '/c.jpg'] }]);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/a.jpg');
    expect(screen.getByText(COUNT_RE)).toHaveTextContent('1/3');
    expect(screen.queryByText('Property Image')).not.toBeInTheDocument();
  });

  it('shows the image but no count when there is exactly one', () => {
    show([{ ...base, images: ['/only.jpg'] }]);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/only.jpg');
    expect(screen.queryByText(COUNT_RE)).not.toBeInTheDocument();
  });

  it('ignores blank entries rather than counting them', () => {
    // admin.tsx seeds images with [""] and filters on submit; be defensive anyway.
    show([{ ...base, images: ['', '  '] }]);
    expect(screen.queryByText(COUNT_RE)).not.toBeInTheDocument();
    expect(screen.getByText('Property Image')).toBeInTheDocument();
  });
});
