/**
 * Where the v1 bash installer put everything. v2 only ever reads from this
 * path (detection in `doctor`, copy-out in `migrate`) — it is never written to
 * and never deleted, because a live stack may still be bind-mounted from it.
 */
export const LEGACY_INSTALL_DIR = '/usr/local/lib/public-services-containers';
