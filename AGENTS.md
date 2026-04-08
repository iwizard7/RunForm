<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:version-bump-rule -->
# Version Bumping Rule

Whenever you add a new feature or make a significant change to the project during your session, you MUST bump the application version in `package.json`. 
The UI relies on `package.json` to display the current app version.
Use `npm version patch` for small bugfixes or `npm version minor` for new features before you finalize and push your work!
<!-- END:version-bump-rule -->
