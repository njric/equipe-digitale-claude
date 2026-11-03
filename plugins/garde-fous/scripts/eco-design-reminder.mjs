// Hook: SessionStart
// Reminds Claude of the eco-design skill. Fires in every session: a new app
// starts from an empty folder, and that first session is where the stack and
// dependencies are chosen, before any package.json exists.

import { runHook, projectDir, printJson } from './lib/hook-io.mjs';
import { isWebProject } from './lib/web-project.mjs';

const RULES =
  'apply the eco-design skill when adding a dependency, an image or heavy asset, ' +
  'a network call or caching, and run its impact review (plans/impact.md) before opening any Pull Request.';

runHook(() => {
  const additionalContext = isWebProject(projectDir())
    ? `Eco-design: this is a web project. ${RULES.charAt(0).toUpperCase()}${RULES.slice(1)}`
    : `Eco-design: if this project is or becomes a web app, ${RULES}`;
  printJson({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } });
});
