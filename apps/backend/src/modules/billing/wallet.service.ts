import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  wallets,
  walletTransactions,
  platformInvoices,
  users,
} from "../../database/schema/index.js";
import { MidtransService } from "./midtrans.service.js";

type WalletTxType =
  | "topup"
  | "deduct_subscription"
  | "deduct_transaction"
  | "deduct_setup"
  | "refund";

// Money kept as 2-decimal strings in PG; compute in integer cents to avoid FP.
const toCents = (v: string | number) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly midtrans: MidtransService,
  ) {}

  async getWallet(userId: string) {
    const [w] = await this.db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (!w) throw new NotFoundException("Wallet not found");
    const txs = await this.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.walletId, w.id))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(20);
    return { balance: w.balance, currency: w.currency, transactions: txs };
  }

  /** Start a top-up: create a pending invoice + a Midtrans Snap transaction. */
  async topUp(userId: string, amount: number) {
    if (!Number.isFinite(amount) || amount < 1000) {
      throw new BadRequestException("Minimum top-up is Rp 1.000");
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException("User not found");

    const [invoice] = await this.db
      .insert(platformInvoices)
      .values({ userId, type: "topup", amount: amount.toFixed(2), status: "pending" })
      .returning();

    const snap = await this.midtrans.createSnap({
      orderId: invoice!.id,
      amount,
      customer: { name: user.fullName ?? undefined, email: user.email ?? undefined },
    });

    await this.db
      .update(platformInvoices)
      .set({ midtransOrderId: invoice!.id, midtransPaymentUrl: snap.redirectUrl })
      .where(eq(platformInvoices.id, invoice!.id));

    return { invoiceId: invoice!.id, token: snap.token, redirectUrl: snap.redirectUrl };
  }

  /** Midtrans webhook handler — verifies signature, credits wallet idempotently. */
  async handleNotification(payload: {
    order_id: string;
    status_code: string;
    gross_amount: string;
    signature_key: string;
    transaction_status: string;
    fraud_status?: string;
  }) {
    const valid = await this.midtrans.verifyNotification(payload);
    if (!valid) throw new BadRequestException("Invalid Midtrans signature");

    const outcome = this.midtrans.outcome(payload.transaction_status, payload.fraud_status);

    return this.db.transaction(async (tx) => {
      const [invoice] = await tx
        .select()
        .from(platformInvoices)
        .where(eq(platformInvoices.id, payload.order_id))
        .for("update")
        .limit(1);
      if (!invoice) throw new NotFoundException("Invoice not found");

      // Idempotency: only act on a still-pending invoice.
      if (invoice.status !== "pending") {
        return { status: invoice.status, idempotent: true };
      }

      if (outcome === "pending") return { status: "pending" };
      if (outcome === "failed") {
        await tx
          .update(platformInvoices)
          .set({ status: "failed" })
          .where(eq(platformInvoices.id, invoice.id));
        return { status: "failed" };
      }

      // paid → mark invoice + credit wallet within the same transaction.
      await tx
        .update(platformInvoices)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(platformInvoices.id, invoice.id));

      if (invoice.type === "topup") {
        await this.creditTx(tx, invoice.userId, Number(invoice.amount), "topup", invoice.id, "Top-up via Midtrans");
      }
      return { status: "paid" };
    });
  }

  /** Atomic deduction with row lock (used by per-transaction billing). */
  async deduct(
    userId: string,
    type: Exclude<WalletTxType, "topup" | "refund">,
    amount: number,
    referenceId?: string,
    description?: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [w] = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .for("update")
        .limit(1);
      if (!w) throw new NotFoundException("Wallet not found");

      const beforeC = toCents(w.balance);
      const amtC = toCents(amount);
      if (amtC <= 0) throw new BadRequestException("Amount must be positive");
      if (beforeC < amtC) throw new BadRequestException("Insufficient balance");

      const afterC = beforeC - amtC;
      await tx
        .update(wallets)
        .set({ balance: fromCents(afterC), updatedAt: new Date() })
        .where(eq(wallets.id, w.id));
      await tx.insert(walletTransactions).values({
        walletId: w.id,
        type,
        amount: fromCents(amtC),
        balanceBefore: fromCents(beforeC),
        balanceAfter: fromCents(afterC),
        referenceId,
        description,
      });
      return { balanceAfter: fromCents(afterC) };
    });
  }

  private async creditTx(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    userId: string,
    amount: number,
    type: WalletTxType,
    referenceId?: string,
    description?: string,
  ) {
    const [w] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for("update")
      .limit(1);
    if (!w) throw new NotFoundException("Wallet not found");
    const beforeC = toCents(w.balance);
    const afterC = beforeC + toCents(amount);
    await tx
      .update(wallets)
      .set({ balance: fromCents(afterC), updatedAt: new Date() })
      .where(eq(wallets.id, w.id));
    await tx.insert(walletTransactions).values({
      walletId: w.id,
      type,
      amount: fromCents(toCents(amount)),
      balanceBefore: fromCents(beforeC),
      balanceAfter: fromCents(afterC),
      referenceId,
      description,
    });
  }
}
