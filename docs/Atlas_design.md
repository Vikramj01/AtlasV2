# Design Handoff: Atlas Signal Intelligence Platform

## 1. Visual Identity & Theme
**The Creative North Star: "The Silent Intelligence"**
The design is minimalist, functional, and data-dense, avoiding unnecessary chrome or decoration.

### Color Palette
- **Primary:** Navy Blue `#1B2A4A` (Logo, Primary Buttons, Active Navigation)
- **Accent:** Medium Blue `#2E75B6` (Links, Active States, Secondary CTAs)
- **Text Primary:** `#1A1A1A` (Body Copy, Headers)
- **Text Secondary:** `#6B7280` (Muted Labels, Descriptions)
- **Background:** `#FFFFFF` (Main Canvas)
- **Surface/Cards:** `#F9FAFB` (Card Backgrounds)
- **Border:** `#E5E7EB` (1px Solid)

### Severity System
*Note: Use a 3px left border on cards for these states.*
- **Critical:** `#DC2626` (Red)
- **Warning:** `#D97706` (Amber)
- **Success:** `#059669` (Green)
- **Info:** `#2E75B6` (Blue)

### Typography
- **Font Stack:** Inter, system-ui, sans-serif.
- **Page Titles:** 24px Semibold, `#1A1A1A`
- **Section Headers:** 16px Semibold
- **Body:** 14px Regular
- **Captions/Labels:** 12px Medium, Uppercase for dividers.

---

## 2. Layout Architecture
### Global Shell
- **Sidebar (Fixed):** 240px wide. White background, 1px right border.
- **Top Header:** Fixed, 64px height. Contains Workspace badge, user profile, and sign-out.
- **Main Content:** Flex-grow, scrollable. Minimum width 1280px.

### Component Specs
- **Cards:** White or `#F9FAFB` background, 1px solid `#E5E7EB` border. Border-radius: 8px. No heavy shadows.
- **Tables:** Sticky headers, alternating row colors (`#FFFFFF` / `#F9FAFB`).
- **Icons:** Lucide-style, 20px, 1.5px stroke.
- **Buttons:**
    - **Primary:** Navy fill, White text.
    - **Secondary:** White fill, Navy border.
    - **Ghost:** Text only, blue underline on hover.

---

## 3. Screen-Specific Logic

### Screen 1: Home Dashboard
- **Priority:** Action-oriented.
- **Metric Bar:** 4 equal cells. Health status cell should have a subtle tint matching its severity level.
- **Action Cards:** Must support dynamic severity (3px left border).

### Screen 2: Signal Health
- **Score Circle:** 180px diameter, Navy stroke.
- **Guidance:** Plain-language interpretation is critical below the score.

### Screen 3: Set Up Tracking (Wizard)
- **Stepper:** Linear flow. 7 steps. Completed steps = green check, current = navy fill.

### Screen 4: Verify Journeys
- **Journey Flow:** Nodes connected by arrows. Each node needs a pass/fail indicator.

### Screen 5: Tracking Map
- **Grid/List Toggle:** Maintain state of view preference.
- **Pill Filters:** Multi-select capable.

### Screen 6: Conversion API
- **Area Chart:** Delivered (Navy) vs Failed (Light Red). 7-day rolling window.

### Screen 7: Developer Handoff
- **Utility:** One-click copy for the share URL.
- **Checklist:** Individual signal expansion to show specific implementation errors.

### Screen 8: Consent & Privacy
- **Live Preview:** Banner configuration changes should reflect immediately in the mock UI.

---

## 4. Implementation Notes
- **Empty States:** Use minimal navy line art.
- **Loading:** Use Skeleton shimmer (Tailwind `animate-pulse` or similar).
- **Tooltips:** All (ℹ️) icons must show a hover state with "So What?" guidance.
