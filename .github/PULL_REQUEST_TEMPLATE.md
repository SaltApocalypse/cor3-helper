## Summary

Brief description of the changes.

## Changes

- Change 1
- Change 2

## Related Issues

Closes #

## Testing

How were these changes tested?

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Loaded `dist/` in Chrome and tested on cor3.gg
- [ ] Verified no new console errors on `chrome://extensions` or the game page
- [ ] Tested affected automation features with automation enabled
- [ ] Checked the related feature or regression path

## Checklist

- [ ] Source follows the layering and TypeScript rules in `AGENTS.md`
- [ ] External data is validated with Zod at the boundary
- [ ] No bearer token, JWT, cookie or session ID is persisted or logged
- [ ] Docs updated when behavior, architecture or decisions changed
- [ ] `cor3Fork.build` incremented for local build identification when needed
- [ ] PR targets the `v2` branch
