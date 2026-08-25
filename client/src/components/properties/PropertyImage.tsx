import type { ReactNode } from 'react';

/**
 * First real image, else `children` as the placeholder. Fills its parent, which must be
 * positioned for the count badge. Count comes from the array — never invent one.
 */
export function PropertyImage({
  images,
  alt,
  children,
}: {
  images?: string[];
  alt?: string;
  children: ReactNode;
}) {
  const photos = (images ?? []).filter((u) => u && u.trim() !== '');
  if (photos.length === 0) return <>{children}</>;

  return (
    <>
      {photos.length > 1 && (
        <div className="absolute bottom-3 right-3 badge-dark text-xs">1/{photos.length}</div>
      )}
      <img src={photos[0]} alt={alt ?? 'Property'} className="w-full h-full object-cover" />
    </>
  );
}
