# Release notes

Run `npm run changeset` after a user-visible change, pick a bump size and
describe the change. Commit the generated Markdown file with the change.
Documentation and test-only changes can skip it.

Pending changesets make the release workflow open a release PR; merging it
publishes the release. For previews, run `npm run changeset -- pre enter beta`
(or `alpha`, `canary`) first, and `npm run changeset -- pre exit` to graduate.
Don't edit the version by hand.
