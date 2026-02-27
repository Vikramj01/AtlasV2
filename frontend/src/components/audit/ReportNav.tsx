interface Page {
  id: number;
  label: string;
}

const PAGES: Page[] = [
  { id: 1, label: 'Executive Summary' },
  { id: 2, label: 'Journey Breakdown' },
  { id: 3, label: 'Platform Impact' },
  { id: 4, label: 'Issues & Fixes' },
  { id: 5, label: 'Technical Appendix' },
];

interface Props {
  currentPage: number;
  onPageChange: (page: number) => void;
}

export function ReportNav({ currentPage, onPageChange }: Props) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-gray-200 bg-white px-6 pt-4">
      {PAGES.map((p) => (
        <button
          key={p.id}
          onClick={() => onPageChange(p.id)}
          className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            currentPage === p.id
              ? 'border-brand-500 text-brand-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="mr-1.5 text-xs text-gray-400">{p.id}</span>
          {p.label}
        </button>
      ))}
    </nav>
  );
}
