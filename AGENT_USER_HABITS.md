# Agent User Habits

This file records the user's preferred collaboration habits for this repo.

## Delivery habits

- After finishing a reasonably complete feature, ask whether to commit and push.
- Prefer frequent, small pushes instead of waiting for a very large batch.
- After implementing a feature, restart the needed local service when practical so the user can refresh the web UI and test.
- Always give short test steps after a feature is ready.
- Keep close-out explanations concise and practical.

## Workspace habits

- Prefer keeping the repo surface tidy.
- Put long development notes into `00_dev_log/` instead of leaving many ad hoc `.md` files in the root.
- Put helper scripts that the user rarely clicks manually into `00_support_tools/` when that does not break the app.
- Keep one clear compatibility area for shared data formats in `data_example/`.
- Treat `00_dev_log/future_plans/` as local planning space by default and do not include its detailed planning files in normal git pushes unless the user explicitly asks.
- When working on the deployed reading app, check whether `UPLOADBOOK/` has new supported files and sync them to the server library so the user can read them on iPad.

## Product habits

- Optimize for fast iteration in the web app first.
- Avoid over-engineering large dictionary or model systems unless the user explicitly wants to pursue them.
- When a feature introduces meaningful behavior change, include a short note about tradeoffs.
