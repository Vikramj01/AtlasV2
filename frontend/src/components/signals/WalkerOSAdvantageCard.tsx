/**
 * WalkerOSAdvantageCard — persistent "why WalkerOS is better" nudge card.
 * Shown on output screens and pack detail pages.
 * Creates migration pressure from GTM to WalkerOS without being obstructive.
 */

interface Props {
  deploymentCount?: number;
  context?: 'output' | 'pack';
}

export function WalkerOSAdvantageCard({ deploymentCount, context = 'output' }: Props) {
  const isPackContext = context === 'pack';

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0">⚡</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-900">
            {isPackContext && deploymentCount && deploymentCount > 1
              ? `You now have ${deploymentCount} clients using this pack`
              : 'You\'re generating GTM output'}
          </p>
          <p className="mt-1 text-xs text-blue-700 leading-relaxed">
            {isPackContext && deploymentCount && deploymentCount > 1
              ? `With GTM, that's ${deploymentCount} separate containers to maintain. With WalkerOS, it's 1 shared config.`
              : 'Switch to WalkerOS for composable, version-controlled tracking that updates across all clients from one place.'}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-blue-200 bg-white/60 p-2.5">
              <p className="font-semibold text-blue-800 mb-1.5">GTM output</p>
              <ul className="space-y-1 text-blue-600">
                <li>· 1 container per client</li>
                <li>· Re-import on every change</li>
                <li>· No native versioning</li>
              </ul>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50/60 p-2.5">
              <p className="font-semibold text-green-800 mb-1.5">WalkerOS output ✓</p>
              <ul className="space-y-1 text-green-700">
                <li>· 1 shared signal pack</li>
                <li>· Update once, all clients updated</li>
                <li>· Git-friendly, version-controlled</li>
              </ul>
            </div>
          </div>

          <p className="mt-2.5 text-xs text-blue-600">
            Both formats are always generated. Download the WalkerOS output to start the migration.
          </p>
        </div>
      </div>
    </div>
  );
}
