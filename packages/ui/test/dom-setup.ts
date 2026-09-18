/**
 * Registers a DOM for the component tests.
 *
 * Bun runs every test file in one process, so registration has to happen once
 * and only once — a second call throws and takes the whole run with it. Both
 * suites import this rather than registering for themselves.
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!globalThis.document) {
  GlobalRegistrator.register();
}
