/**
 * Backend re-export of the payout split logic. The single source of truth lives
 * in @autotoko/shared so the web form's real-time preview and this server's
 * stored result can never drift. Kept as a thin local module so existing imports
 * (`./payout-split`) and the co-located spec stay put.
 */
export {
  calculatePayoutSplit,
  type SplitInput,
  type SplitResult,
  type SedekahBasis,
} from "@autotoko/shared";
