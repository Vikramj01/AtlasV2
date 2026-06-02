# Implementation Health Checks (IHC)

**Available on:** Pro

Implementation Health Checks validate your GTM container configuration against Atlas's tag configuration rules, detect drift from a known-good baseline, and alert you when something breaks.

---

## What it does

- Ingests your GTM container (via OAuth or manual JSON upload).
- Runs tag configuration rule checks against best-practice standards.
- Records a **baseline** snapshot of a passing configuration.
- Detects **drift** — when a subsequent crawl or container import differs from the baseline.
- Sends **alerts** when drift or rule failures exceed your configured severity threshold.

---

## Prerequisites

- Pro plan or above.
- A GTM container (connected via OAuth or uploaded manually).

---

## Connecting Your GTM Container

### Via OAuth

1. Go to **Settings → Implementation Health**.
2. Click **Add GTM connection → Connect with Google**.
3. Authorise Atlas to access your GTM data.
4. Select the GTM container.
5. Click **Connect**.

Atlas fetches the live container JSON automatically.

### Via manual upload

1. Go to **Settings → Implementation Health**.
2. Click **Add GTM connection → Manual upload**.
3. Export your GTM container from GTM Admin → Export Container.
4. Upload the JSON file.

---

## Running a Health Check

1. From the Implementation Health page, select a GTM connection.
2. Click **Run check**.
3. Atlas analyses the container and surfaces findings:
   - **Tag configuration findings** — tags missing required fields, incorrect trigger assignments, deprecated tag types.
   - **Severity levels** — Critical, High, Medium, Low.

---

## Baselines

A baseline is a snapshot of a passing container that future checks diff against.

### Setting a baseline

**From a crawl run:**
1. Go to **Site Scan → Crawl runs**.
2. Find a run where all health checks passed.
3. Click **Promote to baseline**.

**From a container snapshot:**
1. After a successful health check, click **Set as baseline**.

### Drift detection

When subsequent health checks run:
- Atlas compares the current container against the baseline.
- Any tag, trigger, or variable added, removed, or modified is flagged as drift.
- Drift findings show exactly what changed (diff view).

---

## Alert Preferences

Configure when and how you receive alerts:

1. Go to **Settings → Implementation Health → Alert preferences**.
2. Set the **minimum severity** to alert on (e.g. only alert on Critical and High).
3. Configure notification channels:
   - **Email** — enter the recipient addresses.
   - **Slack** — enter the webhook URL.

---

## Findings Archive

All findings from every health check run are archived. You can:
- Filter by severity, rule ID, or date range.
- Track how many times a specific finding has occurred (drift count).
- Export findings as CSV.

---

## Tips & common mistakes

- **Set a baseline after a clean implementation, not before.** A baseline with known issues will mark those issues as acceptable.
- **Re-baseline after intentional changes.** If you deliberately update your GTM container (e.g. adding a new tag), update the baseline — otherwise Atlas will keep flagging the change as drift.
- **Use OAuth connection for live monitoring.** OAuth connections pick up changes to your GTM container automatically. Manual uploads require you to re-upload after every GTM publish.
- **Check IHC after every GTM publish.** GTM changes by colleagues are a common source of tracking drift. Run a health check after each publish to catch issues early.
