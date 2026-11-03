// Hook: SessionStart
// Reminds Claude of the eco-design skill on web projects only.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runHook, projectDir, printJson } from './lib/hook-io.mjs';

runHook(() => {
  if (!existsSync(join(projectDir(), 'package.json'))) return;
  printJson({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext:
        'Eco-design: this is a web project. Apply the eco-design skill when adding a dependency, ' +
        'an image or heavy asset, a network call or caching, and run its impact review ' +
        '(plans/impact.md) before opening any Pull Request.',
    },
  });
});
