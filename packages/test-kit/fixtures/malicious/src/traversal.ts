// Imports that try to escape the workspace root — resolution must stay contained (§42.5).
import { escape } from '../../../../../../etc/passwd';
import { up } from '../../outside-the-root';

export const traversal = (): unknown => ({ escape, up });
