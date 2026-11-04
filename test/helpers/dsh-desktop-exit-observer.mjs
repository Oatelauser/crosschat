export const DSH_DESKTOP_MAIN_SHA256 = '6f3d1ddd1106371452c2204be6dfb2e5460a8e8259cdd05cdccb5387b3f9a85a';

/** Only interprets observations supplied by the trusted, fixture-owned debugger/OS runner. */
export function assessDshDesktopNaturalExit(report, expected) {
  void report; void expected;
  return { verified: false, reason: 'Native graceful teardown has not been observed' };
}
