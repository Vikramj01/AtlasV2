import { cn } from '@/lib/utils';

export interface ReportNavPage {
  id: number;
  label: string;
}

interface Props {
  pages: ReportNavPage[];
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function ReportNav({ pages, currentPage, onPageChange }: Props) {
  return (
    <nav className="flex flex-wrap gap-1 border-b bg-background px-6 pt-4">
      {pages.map((p) => (
        <button
          key={p.id}
          onClick={() => onPageChange(p.id)}
          className={cn(
            'pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
            currentPage === p.id
              ? 'border-[#1B2A4A] text-[#1B2A4A]'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <span className="mr-1.5 text-xs text-muted-foreground/60">{p.id}</span>
          {p.label}
        </button>
      ))}
    </nav>
  );
}
