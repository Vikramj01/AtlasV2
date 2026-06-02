import { useState } from 'react';
import type React from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ValidateFieldPathResponse } from '@/types/enrichment';

type Priority = 'must' | 'recommended' | 'best';
type ValidationState = 'idle' | 'validating' | 'valid' | 'error';

interface FieldMappingRowProps {
  label: string;
  description?: string;
  priority: Priority;
  value: string;
  onChange: (value: string) => void;
  enabled: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
  showToggle?: boolean;
  onValidate?: (path: string) => Promise<ValidateFieldPathResponse>;
  suggestions?: string[];
  placeholder?: string;
  defaultValue?: string;
  validationState?: ValidationState;
  validationMessage?: string;
}

const PRIORITY_LABELS: Record<Priority, string> = {
  must: 'REQUIRED',
  recommended: 'HIGH IMPACT',
  best: 'BEST PRACTICE',
};

const PRIORITY_COLOURS: Record<Priority, string> = {
  must: 'bg-red-100 text-red-700 border-red-200',
  recommended: 'bg-amber-100 text-amber-700 border-amber-200',
  best: 'bg-blue-100 text-blue-700 border-blue-200',
};

export function FieldMappingRow({
  label,
  description,
  priority,
  value,
  onChange,
  enabled,
  onToggleEnabled,
  showToggle = true,
  onValidate,
  suggestions,
  placeholder,
  defaultValue,
  validationState: externalValidationState,
  validationMessage: externalValidationMessage,
}: FieldMappingRowProps) {
  const [internalValidationState, setInternalValidationState] = useState<ValidationState>('idle');
  const [internalValidationMessage, setInternalValidationMessage] = useState<string>('');

  const validationState = externalValidationState ?? internalValidationState;
  const validationMessage = externalValidationMessage ?? internalValidationMessage;

  const handleValidate = async () => {
    if (!onValidate || !value.trim()) return;
    setInternalValidationState('validating');
    setInternalValidationMessage('');
    try {
      const result = await onValidate(value.trim());
      if (result.valid) {
        setInternalValidationState('valid');
        setInternalValidationMessage(
          result.resolved_value !== undefined
            ? `Valid — resolves to: ${JSON.stringify(result.resolved_value)}`
            : 'Valid path syntax',
        );
      } else {
        setInternalValidationState('error');
        setInternalValidationMessage(result.error ?? 'Invalid path');
      }
    } catch {
      setInternalValidationState('error');
      setInternalValidationMessage('Validation failed');
    }
  };

  const handleChange = (v: string) => {
    onChange(v);
    setInternalValidationState('idle');
    setInternalValidationMessage('');
  };

  return (
    <div className={cn('space-y-1.5 py-3 border-b border-gray-100 last:border-0', !enabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm text-gray-900 truncate">{label}</span>
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded border', PRIORITY_COLOURS[priority])}>
            {PRIORITY_LABELS[priority]}
          </span>
        </div>
        {showToggle && onToggleEnabled && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Label className="text-xs text-gray-500">{enabled ? 'Enabled' : 'Disabled'}</Label>
            <Switch checked={enabled} onCheckedChange={onToggleEnabled} />
          </div>
        )}
      </div>

      {description && <p className="text-xs text-gray-500">{description}</p>}

      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(e.target.value)}
          placeholder={placeholder ?? defaultValue ?? 'e.g. customer.email'}
          disabled={!enabled}
          className={cn(
            'font-mono text-sm',
            validationState === 'valid' && 'border-green-400 focus-visible:ring-green-400',
            validationState === 'error' && 'border-red-400 focus-visible:ring-red-400',
          )}
        />
        {onValidate && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!enabled || !value.trim() || validationState === 'validating'}
            onClick={handleValidate}
            className="shrink-0"
          >
            {validationState === 'validating' ? 'Checking…' : 'Validate'}
          </Button>
        )}
      </div>

      {validationMessage && (
        <p
          className={cn(
            'text-xs',
            validationState === 'valid' && 'text-green-600',
            validationState === 'error' && 'text-red-600',
          )}
        >
          {validationState === 'valid' ? '✓ ' : '✗ '}
          {validationMessage}
        </p>
      )}

      {suggestions && suggestions.length > 0 && enabled && (
        <div className="flex flex-wrap gap-1 mt-1">
          <span className="text-xs text-gray-400">Common paths:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => handleChange(s)}
              className="text-xs font-mono text-blue-600 hover:text-blue-800 hover:underline"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
