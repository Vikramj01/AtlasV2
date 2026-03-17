#!/bin/bash
# ============================================================
# Atlas Phase 1: Scaffold Script
# Run from the atlas project root: bash scaffold-phase1.sh
# Creates folder structure + empty placeholder files
# ============================================================

echo "🏗️  Scaffolding Atlas Phase 1: Consent Hub + CAPI Module..."

# --- Types ---
mkdir -p frontend/src/types
# (consent.ts and capi.ts should be copied from the handoff package)

# --- Consent Components ---
mkdir -p frontend/src/components/consent
touch frontend/src/components/consent/ConsentSettings.tsx
touch frontend/src/components/consent/BannerConfigurator.tsx
touch frontend/src/components/consent/BannerPreview.tsx
touch frontend/src/components/consent/CMPIntegration.tsx
touch frontend/src/components/consent/CategoryEditor.tsx
touch frontend/src/components/consent/ConsentAnalyticsDashboard.tsx

# --- CAPI Components ---
mkdir -p frontend/src/components/capi/steps
touch frontend/src/components/capi/ProviderList.tsx
touch frontend/src/components/capi/SetupWizard.tsx
touch frontend/src/components/capi/EMQEstimator.tsx
touch frontend/src/components/capi/CAPIMonitoringDashboard.tsx
touch frontend/src/components/capi/DeliveryTimeline.tsx
touch frontend/src/components/capi/ErrorLog.tsx
touch frontend/src/components/capi/steps/ConnectAccount.tsx
touch frontend/src/components/capi/steps/MapEvents.tsx
touch frontend/src/components/capi/steps/ConfigureIdentifiers.tsx
touch frontend/src/components/capi/steps/TestVerify.tsx
touch frontend/src/components/capi/steps/Activate.tsx

# --- Consent Lib ---
mkdir -p frontend/src/lib/consent
touch frontend/src/lib/consent/consent-engine.ts
touch frontend/src/lib/consent/gcm-mapper.ts
touch frontend/src/lib/consent/banner-generator.ts
touch frontend/src/lib/consent/cmp-listeners.ts

# --- CAPI Lib ---
mkdir -p frontend/src/lib/capi/adapters
touch frontend/src/lib/capi/pipeline.ts
touch frontend/src/lib/capi/hash-pii.ts
touch frontend/src/lib/capi/dedup.ts
touch frontend/src/lib/capi/queue.ts
touch frontend/src/lib/capi/adapters/types.ts
touch frontend/src/lib/capi/adapters/meta.ts
touch frontend/src/lib/capi/adapters/google.ts
touch frontend/src/lib/capi/adapters/tiktok.ts
touch frontend/src/lib/capi/adapters/linkedin.ts

# --- Shared Lib ---
mkdir -p frontend/src/lib/shared
touch frontend/src/lib/shared/crypto.ts

# --- Zustand Stores ---
mkdir -p frontend/src/store
touch frontend/src/store/consentStore.ts
touch frontend/src/store/capiStore.ts

# --- App Router Pages: Consent ---
mkdir -p "frontend/src/app/(dashboard)/consent/analytics"
touch "frontend/src/app/(dashboard)/consent/page.tsx"
touch "frontend/src/app/(dashboard)/consent/analytics/page.tsx"

# --- App Router Pages: CAPI ---
mkdir -p "frontend/src/app/(dashboard)/integrations/capi/[providerId]/setup"
mkdir -p "frontend/src/app/(dashboard)/integrations/capi/[providerId]/dashboard"
touch "frontend/src/app/(dashboard)/integrations/capi/page.tsx"
touch "frontend/src/app/(dashboard)/integrations/capi/layout.tsx"
touch "frontend/src/app/(dashboard)/integrations/capi/[providerId]/setup/page.tsx"
touch "frontend/src/app/(dashboard)/integrations/capi/[providerId]/dashboard/page.tsx"

# --- API Routes: Consent ---
mkdir -p "frontend/src/app/api/v1/consent/[projectId]/[visitorId]"
mkdir -p "frontend/src/app/api/v1/consent/[projectId]/analytics"
mkdir -p "frontend/src/app/api/v1/consent/config"
touch "frontend/src/app/api/v1/consent/route.ts"
touch "frontend/src/app/api/v1/consent/[projectId]/[visitorId]/route.ts"
touch "frontend/src/app/api/v1/consent/[projectId]/analytics/route.ts"
touch "frontend/src/app/api/v1/consent/config/route.ts"

# --- API Routes: CAPI ---
mkdir -p "frontend/src/app/api/v1/capi/providers/[id]/test"
mkdir -p "frontend/src/app/api/v1/capi/providers/[id]/activate"
mkdir -p "frontend/src/app/api/v1/capi/providers/[id]/dashboard"
mkdir -p "frontend/src/app/api/v1/capi/process"
touch "frontend/src/app/api/v1/capi/providers/route.ts"
touch "frontend/src/app/api/v1/capi/providers/[id]/route.ts"
touch "frontend/src/app/api/v1/capi/providers/[id]/test/route.ts"
touch "frontend/src/app/api/v1/capi/providers/[id]/activate/route.ts"
touch "frontend/src/app/api/v1/capi/providers/[id]/dashboard/route.ts"
touch "frontend/src/app/api/v1/capi/process/route.ts"

# --- Supabase Migrations ---
mkdir -p supabase/migrations
# (SQL migration file should be copied from the handoff package)

# --- Scripts ---
mkdir -p scripts
touch scripts/generate-consent-banner.ts

# --- Docs ---
mkdir -p docs
# (PRD and CLAUDE.md should be copied from the handoff package)

echo ""
echo "✅ Scaffolding complete! Structure created:"
echo ""
echo "New directories: 25"
echo "New files: 48 (empty placeholders)"
echo ""
echo "Next steps:"
echo "  1. Copy types/consent.ts and types/capi.ts from handoff package"
echo "  2. Copy the SQL migration to supabase/migrations/"
echo "  3. Copy CLAUDE.md to project root"
echo "  4. Copy the PRD to docs/"
echo "  5. Run: supabase db push (to apply the migration)"
echo "  6. Start Sprint 0 in Claude Code"
echo ""
echo "Recommended Claude Code first prompt:"
echo '  "Read CLAUDE.md and docs/atlas-prd-consent-capi.docx.'
echo '   Start with Sprint 0: implement types/consent.ts, types/capi.ts,'
echo '   lib/shared/crypto.ts (SHA-256 hashing), and lib/capi/hash-pii.ts.'
echo '   Then implement lib/capi/adapters/types.ts (the CAPIProviderAdapter interface)."'
