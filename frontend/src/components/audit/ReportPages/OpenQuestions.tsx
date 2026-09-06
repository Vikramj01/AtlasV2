import type { ReportJSON } from '@/types/audit';

interface Props {
  report: ReportJSON;
}

/**
 * Report Honesty PRD Part B — configurations whose intent only the client
 * can answer, printed as questions rather than caveated as findings. The
 * parent report page only renders this tab when report.open_questions is
 * present and non-empty (PRD §B3 — omit the section entirely rather than an
 * empty heading), so this component doesn't need its own empty state.
 */
export function OpenQuestions({ report }: Props) {
  const questions = report.open_questions ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Open Questions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These are configurations whose intent only you can confirm — not defects, but worth a quick answer before anyone acts on the findings below.
        </p>
      </div>

      <ul className="space-y-3">
        {questions.map((question, i) => (
          <li key={i} className="rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4 text-sm leading-relaxed text-indigo-950">
            {question}
          </li>
        ))}
      </ul>
    </div>
  );
}
