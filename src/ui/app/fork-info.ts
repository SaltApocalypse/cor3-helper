/**
 * Fork and upstream metadata.
 *
 * Runtime update checks and release links point at this fork. Upstream is only
 * credited and linked; the extension never queries upstream at runtime.
 */
export const FORK_REPO = 'SaltApocalypse/cor3-helper';
export const FORK_REPO_URL = `https://github.com/${FORK_REPO}`;
export const FORK_RELEASES_URL = `${FORK_REPO_URL}/releases`;
export const FORK_ISSUES_URL = `${FORK_REPO_URL}/issues`;
export const FORK_DISPLAY_NAME = 'SaltA Fork';

export const UPSTREAM_REPO = 'Femtoce11/cor3-helper';
export const UPSTREAM_REPO_URL = `https://github.com/${UPSTREAM_REPO}`;

export const RELATED_LINKS = [
    { key: 'arg', href: 'https://cor3.gg/' },
    { key: 'site', href: 'https://fragmentaryorder.com/' },
    { key: 'founders', href: 'https://community.cor3.gg/' },
    { key: 'discord', href: 'https://discord.gg/cor3gg' },
    { key: 'x', href: 'https://x.com/fragorder' },
    { key: 'xCorp', href: 'https://x.com/cor3corp' },
    { key: 'guide', href: 'https://docs.google.com/document/d/16-usjgCmiN0MwOE3FmHWpo3PjzU6PIzhiABpRO7GK98' },
] as const;
