#!/bin/bash
# Hook: SessionStart
# Description: Reminds Claude of the eco-design skill on web projects only.

[ -f "${CLAUDE_PROJECT_DIR:-.}/package.json" ] || exit 0

cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Eco-design: this is a web project. Apply the eco-design skill when adding a dependency, an image or heavy asset, a network call or caching, and run its impact review (plans/impact.md) before opening any Pull Request."}}
EOF
exit 0
