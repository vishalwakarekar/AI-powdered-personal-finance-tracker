"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

// ✅ Fix decimal serialization
const serializeDecimal = (obj) => {
  const serialized = { ...obj };

  if (obj.balance) {
    serialized.balance = Number(obj.balance);
  }

  if (obj.amount) {
    serialized.amount = Number(obj.amount);
  }

  return serialized;
};

// ✅ FIXED: get account with validation + correct Prisma query
export async function getAccountWithTransactions(accountId) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  // ❗ IMPORTANT: Check accountId
  if (!accountId) throw new Error("Account ID is missing");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  // ✅ Use findFirst instead of findUnique
  const account = await db.account.findFirst({
    where: {
      id: accountId,
      userId: user.id,
    },
    include: {
      transactions: {
        orderBy: { date: "desc" },
      },
      _count: {
        select: { transactions: true },
      },
    },
  });

  if (!account) return null;

  return {
    ...serializeDecimal(account),
    transactions: account.transactions.map(serializeDecimal),
  };
}

// ✅ BULK DELETE (already mostly correct)
export async function bulkDeleteTransactions(transactionIds) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    const transactions = await db.transaction.findMany({
      where: {
        id: { in: transactionIds },
        userId: user.id,
      },
    });

    const accountBalanceChanges = transactions.reduce((acc, transaction) => {
      const change =
        transaction.type === "EXPENSE"
          ? transaction.amount
          : -transaction.amount;

      acc[transaction.accountId] =
        (acc[transaction.accountId] || 0) + Number(change);

      return acc;
    }, {});

    await db.$transaction(async (tx) => {
      await tx.transaction.deleteMany({
        where: {
          id: { in: transactionIds },
          userId: user.id,
        },
      });

      for (const [accountId, balanceChange] of Object.entries(
        accountBalanceChanges
      )) {
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: {
              increment: balanceChange,
            },
          },
        });
      }
    });

    revalidatePath("/dashboard");
    revalidatePath("/account/[id]");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ✅ FIXED update default account
export async function updateDefaultAccount(accountId) {
  try {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    if (!accountId) throw new Error("Account ID is missing");

    const user = await db.user.findUnique({
      where: { clerkUserId: userId },
    });

    if (!user) throw new Error("User not found");

    // Remove old default
    await db.account.updateMany({
      where: {
        userId: user.id,
        isDefault: true,
      },
      data: { isDefault: false },
    });

    // Set new default
    const account = await db.account.update({
      where: {
        id: accountId,
      },
      data: {
        isDefault: true,
      },
    });

    revalidatePath("/dashboard");

    return {
      success: true,
      data: serializeDecimal(account), // ✅ FIXED
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}