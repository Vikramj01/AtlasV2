import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EventVerdict } from '@/types/campaignSignalValidator';

const RATING_STYLES: Record<EventVerdict['rating'], { badge: string; bar: string }> = {
  strong: { badge: 'bg-green-100 text-green-800 border-green-200', bar: 'bg-green-500' },
  moderate: { badge: 'bg-amber-100 text-amber-800 border-amber-200', bar: 'bg-amber-500' },
  weak: { badge: 'bg-red-100 text-red-800 border-red-200', bar: 'bg-red-500' },
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  high: <AlertTriangle className="h-4 w-4 text-red-600" />,
  medium: <AlertTriangle className="h-4 w-4 text-amber-600" />,
  low: <Info className="h-4 w-4 text-blue-600" />,
};

export function VerdictResultView({ verdict, url }: { verdict: EventVerdict; url?: string }) {
  const styles = RATING_STYLES[verdict.rating];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              {url && <p className="text-xs text-muted-foreground">{url}</p>}
              <div className="mt-1 flex items-center gap-2">
                <Badge className={styles.badge} variant="outline">
                  Signal: {verdict.rating.toUpperCase()}
                </Badge>
                <span className="text-sm text-muted-foreground">Score {verdict.score}/100</span>
                <Badge variant="outline">AI Max risk: {verdict.ai_max_risk}</Badge>
              </div>
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${styles.bar}`} style={{ width: `${verdict.score}%` }} />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{verdict.summary}</p>
        </CardContent>
      </Card>

      {verdict.reasons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Findings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {verdict.reasons.map((reason) => (
              <div key={reason.code} className="flex gap-3 rounded-lg border p-3">
                <div className="mt-0.5 shrink-0">{SEVERITY_ICON[reason.severity]}</div>
                <div>
                  <p className="text-sm font-semibold">{reason.headline}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{reason.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {verdict.reasons.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 className="h-4 w-4" />
          No issues found — the primary conversion signal looks strong.
        </div>
      )}

      {verdict.remediation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommended next steps</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {verdict.remediation.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
