export type ValidationSeverity = 'CRITICAL' | 'HIGH';

export interface ValidationError {
  /** Rule identifier, e.g. 'VARIABLE_RESOLUTION' */
  rule: string;
  severity: ValidationSeverity;
  /** Human-readable location, e.g. 'GTM tag: Google Ads - lead_form_submit Conversion' */
  location: string;
  message: string;
  fix_hint: string;
}

export interface ValidationWarning {
  rule: string;
  location: string;
  message: string;
}

export interface ValidationResult {
  /** false if any CRITICAL errors exist */
  passed: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
