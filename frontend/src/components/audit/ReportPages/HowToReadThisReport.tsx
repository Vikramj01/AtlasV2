/**
 * Report Honesty PRD Part C — what the scan is, not a disclaimer that its
 * output is unreliable. Static copy, matching pdfGenerator.ts's PDF section
 * verbatim: never templated per-audit (PRD §4 — "adjusted for house style",
 * not per-run values).
 */
const PARAGRAPHS = [
  'This is a first-pass technical scan. It was run from outside your systems, without access to your ad accounts, and without a conversation with whoever built your measurement setup. Three things follow from that.',
  'We observed one crawl, from one location, at one moment. A tag that fires conditionally, or a page that behaves differently for signed-in users or in another region, may not appear here as it does for your customers.',
  'We can see what your site does, not what it reports. Match rates, conversion values, attribution windows and platform-side configuration all sit inside your ad accounts, which we have not seen.',
  'We cannot tell deliberate from accidental. A second container may be a migration in progress. An undeclared tag may be a channel we were not told about. A missing tag may mean that platform runs through a different property entirely. Where that distinction matters, we have raised it as a question rather than a finding.',
];

export function HowToReadThisReport() {
  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-lg font-semibold">How to read this report</h2>
      <div className="space-y-4">
        {PARAGRAPHS.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
        ))}
        <p className="text-sm leading-relaxed text-muted-foreground">
          Findings without a confirmation marker were observed consistently and are unlikely to be artefacts of the scan. Findings marked{' '}
          <span className="font-medium text-foreground">Needs confirmation</span> rest on a single observation or a page we could not fully verify, and should be checked before anyone acts on them.
        </p>
      </div>
    </div>
  );
}
