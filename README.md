# Do It For Me (DIFM)

DIFM is an autonomous Chrome extension that handles repetitive web chores so you don't have to. It understands rough notes or instructions, navigates to the necessary websites, fills out forms, tracks prices, and preps checkouts—all right inside your browser. 

Instead of building a traditional bot with hardcoded scripts, DIFM parses the browser's accessibility tree, feeds it to an LLM planner, and executes actions dynamically like a human would.

## What It Actually Does

* **Smart Task Parsing:** Drop a messy note like *"pay cesc bill ~1450 by 15th"* or a screenshot of a bill. The agent extracts the biller, consumer ID, amount, and due date, and automatically schedules the task.
* **Autonomous Execution:** When it's time to act, the extension opens the required website, finds the correct form fields, types your details, and clicks through the steps until the final checkout or UPI screen.
* **Price Tracking & Carting:** Tell it *"buy Sony XM5 if price drops below 29,990"*. It monitors the Amazon page in the background, detects the real price, and adds the item to your cart the moment it hits your target.
* **Identity Vault:** Store personal, work, or household profiles. The agent automatically pulls the right name, email, and billing address depending on the context of the task.
* **Safe by Default:** It prepares everything on-screen but requires a 1-click manual confirmation for sensitive actions like final payments.

## Architecture

This is a `pnpm` monorepo containing the Chrome extension, a backend planner service, and shared libraries.

### 1. `apps/extension`
The core Chrome extension (Manifest V3) built with [WXT](https://wxt.dev/) and Preact. 
* **Sidepanel (`App.tsx`):** The primary UI where users input goals, manage profiles, and monitor execution logs.
* **Content Script (`content.ts`):** Injected into active tabs to capture page states and execute actions.
* **Executor (`executor.ts`):** Handles the physical DOM interactions (`CLICK`, `TYPE`, `SCROLL`). It translates LLM intent into exact DOM events, ensuring elements are highlighted and focused accurately without blocking the main execution loop.

### 2. `packages/a11y-tree`
Instead of feeding raw HTML to the LLM (which is expensive and error-prone), this package translates the webpage's DOM into a lightweight, semantic accessibility tree.
* It filters out decorative elements and extracts only interactive nodes (buttons, inputs, critical links).
* It includes specialized extractors for e-commerce (finding hidden prices and "Add to Cart" node IDs) to streamline execution.

### 3. `apps/server`
The backend planner service that interfaces with the LLM. 
* **Planner (`planner.ts`):** Takes the user's goal and the semantic page tree, and outputs the next logical action (e.g., `{"type": "CLICK", "targetId": "node-123"}`). It includes prompt logic to instantly execute high-priority actions (like adding a discounted item to a cart in a single step).
* Supports multiple LLM backends (OpenAI, Qwen, etc.).

### 4. `packages/shared`
Shared TypeScript types, Zod schemas, and communication protocols (e.g., `PageObservation`, `AgentAction`) used across the extension, server, and libraries.

## Development Setup

**Prerequisites:**
- Node.js (v18+)
- `pnpm`

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Build the shared packages:**
   ```bash
   pnpm -r build
   ```

3. **Run tests (Vitest):**
   ```bash
   pnpm test
   ```

4. **Load the Extension:**
   - Run `pnpm --filter extension dev` for hot-module reloading, or build it for production.
   - Load the unpacked extension from `apps/extension/.output/chrome-mv3` in Chrome (`chrome://extensions/`).

## Core Principles

- **No Artificial Delays:** The execution loop is heavily optimized. Visual highlights are fire-and-forget, and DOM settlement delays are capped at 50-80ms to ensure the agent feels snappy and responsive.
- **In-Tab Context Locking:** Link behaviors (like `target="_blank"`) are neutralized during execution so the agent doesn't lose context by spawning detached tabs.
- **Heuristic Fallbacks:** The semantic extractor uses smart heuristics (like regex matching for common utility domains or price strings) to ensure the LLM gets clean, actionable data even on poorly-coded websites.
