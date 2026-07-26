import type { ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>;

export function BrandMark({ className, alt = 'HysCode logo', ...props }: BrandMarkProps) {
  return (
    <img
      src="/hyscode-logo.svg"
      alt={alt}
      draggable={false}
      className={cn('select-none shrink-0 object-contain', className)}
      {...props}
    />
  );
}
